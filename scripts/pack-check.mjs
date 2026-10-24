/**
 * Checks what npm would receive, the way a consumer meets it. Packs every published package (each `prepack` builds it
 * through turbo's cache), asserts what must and must not ship in each tarball, then installs it into a throwaway app
 * and type-checks real usage with a consumer's TypeScript: no `source` condition, no workspace links, only what the
 * tarball declares. The config plugin is loaded from the tarball too, the way prebuild loads it.
 *
 * The negative cases matter as much as the positive ones: if a declaration failed to resolve, its imports would
 * quietly become `any` and everything would compile, so each `@ts-expect-error` is there to prove the types are real.
 */
import {execFileSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WORK = path.join(ROOT, '.pack-check')

const run = (command, args, cwd = ROOT) => execFileSync(command, args, {cwd, encoding: 'utf8'})

const fail = message => {
  console.error(`pack-check: ${message}`)
  process.exit(1)
}

const REQUIRED = {
  '@hzblj/expo-translation': [
    'package.json',
    'README.md',
    'LICENSE',
    'app.plugin.js',
    'build/index.js',
    'build/index.d.ts',
    'build/types.d.ts',
    'plugin/build/index.js',
    'plugin/build/index.d.ts',
    'expo-module.config.json',
    'ios/ExpoTranslation.podspec',
    'ios/ExpoTranslationModule.swift',
    'ios/HostedSessions.swift',
    'ios/TranslatorObject.swift',
    'ios/Core/AppleEngine.swift',
    'ios/Core/TranslatorCore.swift',
    'ios/Core/Engine.swift',
    'ios/MLKit/MLKitEngine.swift',
    'android/build.gradle',
    'android/src/main/AndroidManifest.xml',
    'android/src/main/java/com/hzblj/expotranslation/ExpoTranslationModule.kt',
    'android/src/main/java/com/hzblj/expotranslation/MLKitEngine.kt',
    'android/src/main/java/com/hzblj/expotranslation/TranslatorCore.kt',
  ],
}

// The tests of all four and the build output of the native projects stay home. The TypeScript source ships: `exports`
// names it under the `source` condition.
const FORBIDDEN = [
  /^test\//,
  /^plugin\/(src|test)\//,
  /^ios\/Tests\//,
  /^android\/src\/test\//,
  /\/build\/intermediates\//,
  /\.DS_Store$/,
]

const packages = []

for (const directory of await readdir(path.join(ROOT, 'packages'))) {
  const manifestPath = path.join(ROOT, 'packages', directory, 'package.json')

  if (!existsSync(manifestPath)) {
    continue
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  if (!manifest.private) {
    packages.push({directory, name: manifest.name})
  }
}

await rm(WORK, {force: true, recursive: true})
await mkdir(path.join(WORK, 'tarballs'), {recursive: true})

let fileCount = 0

for (const {directory, name} of packages) {
  const tarball = path.join(WORK, 'tarballs', `${directory}.tgz`)

  run('yarn', ['pack', '--out', tarball], path.join(ROOT, 'packages', directory))

  const files = run('tar', ['-tzf', tarball])
    .split('\n')
    .filter(Boolean)
    .map(file => file.replace(/^package\//, ''))

  const missing = (REQUIRED[name] ?? ['package.json', 'README.md']).filter(file => !files.includes(file))
  const leaked = files.filter(file => FORBIDDEN.some(pattern => pattern.test(file)))

  if (missing.length > 0) {
    fail(`${name} is missing:\n  ${missing.join('\n  ')}`)
  }

  if (leaked.length > 0) {
    fail(`${name} must not ship:\n  ${leaked.join('\n  ')}`)
  }

  const packed = JSON.parse(run('tar', ['-xzOf', tarball, 'package/package.json']))

  if (JSON.stringify(packed.dependencies ?? {}).includes('workspace:')) {
    fail(`${name} still declares a workspace: range: it would not install outside this repo`)
  }

  const installed = path.join(WORK, 'node_modules', name)

  await mkdir(installed, {recursive: true})
  run('tar', ['-xzf', tarball, '-C', installed, '--strip-components', '1'])
  fileCount += files.length
}

// The config plugin, as prebuild requires it: `app.plugin.js` from the tarball, run over a minimal config.
const plugin = createRequire(path.join(WORK, 'package.json'))('@hzblj/expo-translation/app.plugin.js')
const withTranslation = plugin.default ?? plugin

if (typeof withTranslation !== 'function') {
  fail('app.plugin.js does not export a config plugin')
}

withTranslation({name: 'Consumer', slug: 'consumer'}, {ios: {mlkit: true}})

const consumer = `import {
  type LanguageIdentification,
  type PairStatus,
  Translation,
  type TranslationError,
  type TranslationResult,
  Translator,
  useLanguageStatus,
  useTranslation,
  useTranslator,
} from '@hzblj/expo-translation'
import type {TranslationPluginOptions} from '@hzblj/expo-translation/plugin'

export const translator = new Translator({from: 'de', ios: {strategy: 'highFidelity'}, to: 'cs'})

export const once = async (): Promise<string> => {
  await translator.prepareAsync()
  const one: TranslationResult = await translator.translateAsync('Guten Morgen!')
  const all = await translator.translateBatchAsync(['Eins', 'Zwei'], {onResult: (result, index) => result.text + index})
  const shared = await Translation.translateAsync('Bonjour', {download: false, to: 'en', wifiOnly: true})
  return [one.text, ...all.map(result => result.text), shared.engine ?? 'unchanged'].join(' ')
}

export const languages = async () => {
  const status: PairStatus = await Translation.getStatusAsync({from: 'cs', to: 'en'})
  const identified: LanguageIdentification = await Translation.identifyLanguageAsync('Dobrý den', {maxCandidates: 2})
  await Translation.downloadAsync({from: 'cs', ios: {engine: 'mlkit'}, to: 'en'})
  const name: string = Translation.languageName(identified.language ?? 'cs')
  const replaced: string | null = await Translation.presentTranslationAsync('Hallo', {replace: true})
  return [status.status, name, replaced, (await Translation.getAvailabilityAsync()).reason]
}

export const Row = ({text}: {text: string}) => {
  const mine = useTranslator({to: 'en'})
  const {text: translated, error, retry} = useTranslation(text, mine)
  const shared = useTranslation(text, {from: 'de', to: 'en'})
  const {status, refresh} = useLanguageStatus({from: 'de', to: 'en'})
  const failure: TranslationError | null = error
  return failure?.code === 'not-installed' ? retry() : [translated, shared.text, status, refresh]
}

export const options: TranslationPluginOptions = {ios: {mlkit: true}}

// @ts-expect-error: a translator needs a target language
export const noTarget = new Translator({from: 'de'})

// @ts-expect-error: the engine is auto, apple or mlkit
export const wrongEngine = new Translator({ios: {engine: 'google'}, to: 'en'})

// @ts-expect-error: the strategy is an iOS option, under ios
export const misplaced = new Translator({strategy: 'highFidelity', to: 'en'})
`

await writeFile(path.join(WORK, 'consumer.tsx'), consumer)
await writeFile(
  path.join(WORK, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {noEmit: true, skipLibCheck: true, strict: true},
      extends: 'expo/tsconfig.base',
      include: ['consumer.tsx'],
    },
    null,
    2
  )
)

try {
  run('yarn', ['run', '-T', 'tsc', '-p', WORK])
} catch (error) {
  fail(`a consumer's type check failed:\n${error.stdout}`)
}

await rm(WORK, {force: true, recursive: true})

console.log(`pack-check: ${packages.length} package, ${fileCount} files, the plugin runs and a consumer type-checks`)
