# @hzblj/expo-translation

[![npm](https://img.shields.io/npm/v/@hzblj/expo-translation.svg)](https://www.npmjs.com/package/@hzblj/expo-translation)
[![license](https://img.shields.io/npm/l/@hzblj/expo-translation.svg)](https://github.com/hzblj/expo-translation/blob/main/LICENSE)

On-device translation for Expo on the platforms' own engines. Nothing is sent anywhere: the text is translated on the phone, offline once its languages are downloaded.

- **iOS 18:** Apple's Translation framework. Languages are downloaded with the user's consent, in Apple's own sheet. iOS 26 translates installed languages without any view, and iOS 26.4 adds Apple Intelligence's model (`highFidelity`).
- **Android:** Google's ML Kit, 59 languages, a model of about 30 MB per language that the app downloads and deletes itself.
- **ML Kit on iOS too, when you want it:** Apple's framework has no Czech, Slovak, Hungarian, Romanian or Greek (among others). The config plugin's `ios.mlkit` bundles ML Kit for them, and `auto` translators use whichever engine can.
- **Fast in lists:** a `Translator` keeps its engine loaded, the texts a screen asks for at once go to the engine as one batch, each one arrives the moment it is done, and every translation is cached, so a list that scrolls back renders without waiting.
- **Language identification:** Natural Language on iOS, ML Kit on Android, and `from` can be left out to translate whatever each text is written in.
- **Apple's translation sheet** on iOS 17.4, with "Replace with Translation".

## Install

```sh
npx expo install @hzblj/expo-translation
```

Requires Expo SDK 57 or newer and a [development build](https://docs.expo.dev/develop/development-builds/introduction/). Expo Go doesn't include this native module.

Nothing has to be configured: neither engine needs a permission. The config plugin is only for ML Kit on iOS:

```json
{
  "plugins": [["@hzblj/expo-translation", {"ios": {"mlkit": true}}]]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `ios.mlkit` | `false` | Bundles Google's ML Kit on iOS for the languages Apple's framework lacks. It makes the app bigger, and since ML Kit's frameworks have no arm64 simulator slice, the app's simulator builds leave arm64 out (they run on an x86_64 simulator, or on a device). Run a new prebuild after changing it. |

## Translate

```tsx
import {Translation, useTranslation, useTranslator} from '@hzblj/expo-translation'

// Once, with a translator kept for these options.
const {text} = await Translation.translateAsync('Der Zug fährt um acht.', {from: 'de', to: 'en'})

// In a component: the translation, re-rendered when it arrives.
const Row = ({message}: {message: string}) => {
  const {text, translating, error} = useTranslation(message, {to: 'en'})

  return <Text>{text ?? message}</Text>
}
```

Without `from`, each text's language is identified first, and a text already in the target language comes back as it is (`engine: null`).

A `Translator` translates into one language and keeps its engine loaded while it lives. Make one per configuration and reuse it; `useTranslator` makes one for a component and releases it on unmount:

```tsx
const translator = useTranslator({from: 'de', to: 'cs'})

await translator.prepareAsync() // downloads what is missing and loads the model, before the first text
const result = await translator.translateAsync('Guten Morgen!')
const results = await translator.translateBatchAsync(sentences, {
  onResult: (result, index) => show(index, result.text), // each one as soon as it is done
})
```

| Result | Meaning |
| --- | --- |
| `text` | The translation (the text itself when it was already in the target language). |
| `sourceText` | The text as it was given. |
| `sourceLanguage`, `targetLanguage` | BCP 47 tags: the one given as `from`, or the one identified. |
| `engine` | `apple`, `mlkit`, or `null` when nothing had to translate it. |
| `fromCache` | Whether it came from the cache without translating anything. |

### What makes it fast

- **The engine stays loaded.** Loading a model takes a second or two the first time (1.2 to 2 s on an Android emulator); after that a sentence takes tens of milliseconds. A `Translator` keeps it loaded, `Translation.translateAsync` keeps one per configuration, and `prepareAsync` loads it before the first text is on screen.
- **One batch per screen.** `translateAsync` gathers every text asked of a translator in the same JavaScript task (a list renders its rows, each with its `useTranslation`, in one go) and sends them on together at the end of it, as a microtask: no timer, no delay. Apple's engine translates a batch as one request.
- **Each text as soon as it is done.** A batch doesn't wait for its slowest text: the native side reports every translation the moment the engine has it, and that text's promise settles, so rows light up one by one. On an Android emulator, 24 sentences came back in 257 ms, the first after 41 ms.
- **A cache.** Every translation is kept (1,000, least recently used out first) by its configuration and text. `useTranslation` reads it while rendering, so a translated row is complete on its first render, without a second one. The same text asked for twice while it is being translated is translated once. `Translation.clearCache()` empties it.
- **Grouping by language.** Without `from`, texts are identified natively and each language goes to its engine as its own batch, the languages at the same time.

## Options

```ts
type TranslatorOptions = {
  from?: string            // the text's language; unset: identified per text
  to: string               // the language to translate into
  download?: boolean       // download a missing language when first needed (default true)
  wifiOnly?: boolean       // ML Kit: download over Wi-Fi only (default false)
  ios?: {
    engine?: 'auto' | 'apple' | 'mlkit' // default 'auto'
    strategy?: 'lowLatency' | 'highFidelity' // iOS 26.4, default 'lowLatency'
  }
}
```

- `download: true` (the default) downloads what a translation needs. Apple's engine asks the user first, in its own sheet; ML Kit downloads without asking. With `false`, a missing language fails the text with `not-installed`, which is the way for a list of many languages: offer the download yourself (`Translation.downloadAsync`), and every `useTranslation` waiting on `not-installed` tries again by itself once a download succeeds.
- `ios.engine: 'auto'` picks the engine that already has both languages, otherwise Apple's, then ML Kit when it is bundled.
- `ios.strategy: 'highFidelity'` uses Apple Intelligence's model where the device has it (nothing to download), and the traditional models elsewhere.

## Languages

```ts
const languages = await Translation.getSupportedLanguagesAsync() // [{language: 'de', name: 'German', engine: 'apple'}, …]
const {status, engine} = await Translation.getStatusAsync({from: 'cs', to: 'en'}) // 'installed' | 'downloadable' | 'unsupported'
await Translation.downloadAsync({from: 'cs', to: 'en'})

await Translation.getDownloadedLanguagesAsync() // ML Kit's models: ['cs', 'de']
await Translation.deleteDownloadedLanguageAsync('cs')

Translation.languageName('pt-PT') // 'Portuguese (Portugal)', synchronous
```

Tags are BCP 47 (`cs`, `en-GB`, `pt-PT`, `zh-Hant`). Apple's engine lists regional variants (`en`, `en-GB`, `es-MX`, `zh-TW`); ML Kit lists languages (`en`, `zh` for Simplified Chinese only). Names come from the platform, in the device's language, because Hermes has no `Intl.DisplayNames`.

Apple's languages are the system's: downloaded only with the user's consent, listed in Settings, never deleted by an app, so `getDownloadedLanguagesAsync` lists ML Kit's alone. ML Kit has English built in; it can't be deleted.

### Identification

```ts
const {language, confidence, candidates} = await Translation.identifyLanguageAsync('Dobrý den, jak se máte?')
// 'cs', 0.99, [{language: 'cs', confidence: 0.99}, {language: 'sk', confidence: 0.01}]
```

A sentence or two is enough; a single word often isn't. `language` is `null` when the text says too little.

## Apple's translation sheet

```ts
const replacement = await Translation.presentTranslationAsync(text, {replace: true})

if (replacement) {
  setText(replacement) // the user picked "Replace with Translation"
}
```

iOS 17.4 and later: the system's own translation UI over the app, with its language pickers. It resolves with the translation when the user picks "Replace with Translation", and with `null` when the sheet is closed. Android has no such sheet and resolves `null` at once (`availability.translationSheet` says whether there is one).

## Errors

Errors carry a `code`. In a batch, a text that fails rejects its own promise only (`translateBatchAsync` rejects with the first).

| Code | Meaning |
| --- | --- |
| `unsupported-language` | No engine on this device translates the pair. |
| `not-installed` | A language isn't downloaded and the translator may not download it (`download: false`). |
| `download-declined` | The user declined Apple's download sheet, or closed it while the languages were downloading (they keep downloading). |
| `unable-to-identify` | `from` wasn't given and the text's language couldn't be told. |
| `unavailable` | Nothing translates on this device (see below). |
| `network` | A model couldn't be downloaded. |
| `cancelled`, `unknown` | |

## Platform behavior

`Translation.getAvailabilityAsync()` says what this device has:

```ts
const {available, engines, reason, translationSheet, manageDownloads} = await Translation.getAvailabilityAsync()
```

- **iOS:** Apple's framework needs iOS 18 and a device: the simulator doesn't translate (it calls every pair unsupported), so there `available` is `false` with `reason: 'simulator'`, unless ML Kit is bundled. Before iOS 26, and for any download, a session needs a view in a window: the module places an invisible one-point view over the app's top view controller while it translates, and removes it once it has been idle for 20 seconds. From iOS 26, installed languages translate without it.
- **Android:** ML Kit on any device with Google's model downloads, the emulator included. Translations between two languages that aren't English go through English. ML Kit loses line breaks, so each line is translated on its own and the breaks are put back. Language identification is bundled (about 900 KB per ABI), so it works without Play services.
- **ML Kit on iOS:** the same engine as Android, with the same 59 languages, used for what Apple lacks.

## Example

[`apps/example`](https://github.com/hzblj/expo-translation/tree/main/apps/example): fifteen Wikipedias' articles of the day translated on the device, a playground with identification, Apple's sheet and a batch with its timings, and the languages with their downloads.

## License

MIT © Jan Blazej
