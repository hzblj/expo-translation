# expo-translation

Yarn 4 + Turborepo monorepo for **`@hzblj/expo-translation`**: on-device translation for Expo on Apple's Translation
framework (iOS 18) and Google's ML Kit (Android, and iOS when the config plugin bundles it), with language checks and
downloads, identification, batches that arrive text by text, a cache and hooks. Read the package's own `CLAUDE.md`
before touching it.

| Path | What lives there |
| --- | --- |
| `packages/expo-translation/` | The published package: `src/` (JS, cache, hooks), `ios/` (Swift; `ios/Core` also builds as a SwiftPM package for Mac tests; `ios/MLKit` only with ML Kit), `android/` (Kotlin), `plugin/` (the config plugin). |
| `apps/example/` | The example: Wikipedias' articles of the day translated on the device, a playground, the languages. Built from `@hzblj/kara-ui`. Private. |
| `scripts/pack-check.mjs` | Packs the package as npm gets it, checks what ships, runs the plugin and type-checks a throwaway consumer. |
| `.changeset/`, `.github/workflows/` | Release notes, CI (Biome, types, tests, pack check, the Android module compiled) and the changesets release to npm. |

## Commands

```bash
yarn ios / yarn android   # run the example (dev client)
yarn prebuild             # clean `expo prebuild` of the example (builds the package first); MLKIT=1 adds ML Kit on iOS
yarn lint / yarn typecheck
yarn test                 # JS (the cache) and plugin tests (Node)
yarn test:ios             # Swift tests on the Mac against the real Translation framework
yarn test:android         # Kotlin JVM tests (after `yarn prebuild`)
yarn pack:check
yarn changeset
```

## Conventions

- Commits are Jan Blazej's (`hello@janblazej.dev`), with no co-author trailers.
- Workspaces resolve each other's TypeScript source: the example maps `@hzblj/expo-translation` to `src/` (tsconfig
  `paths`, `metro.config.js`), so no build is needed to run it. The published entry points are `build/`.
- Docs copy (READMEs, JSDoc that becomes docs, changesets) has no em dashes.
- `yarn release` publishes through Yarn (`workspace:` ranges rewritten) and tags through changesets.
- **iOS 27 needs the scene life cycle.** Built with the iOS 27 SDK, an app without it stops at launch (UIKit's
  `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`), and Expo 57's prebuild template has none. The
  example's `app.config.ts` adopts it with `withSceneLifecycle` (Expo's own `ExpoAppSceneDelegate`, as Expo 58's
  template does); drop that plugin when the example moves to Expo 58. The library itself works either way.
- Apple's framework doesn't translate in any simulator; run on a device, or prebuild with `MLKIT=1` and use an x86_64
  simulator.
