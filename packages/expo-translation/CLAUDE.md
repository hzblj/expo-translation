# @hzblj/expo-translation

On-device translation for Expo. An Expo module (`ExpoTranslation`: `ios/`, `android/`), its JS (`src/` → `build/`) and
a config plugin (`plugin/` → `plugin/build/`, loaded through `app.plugin.js`) whose only job is ML Kit on iOS.

## The shape

**One shared object.** `Translator` is a configuration (`from`, `to`, `download`, `wifiOnly`, `ios.engine`,
`ios.strategy`), a native `SharedObject` that keeps its engines' sessions and models loaded while JavaScript holds it.
`useTranslator` releases it on unmount; `Translation.translateAsync` keeps one per configuration (`sharedTranslator`,
keyed by `optionsKey`, sorted keys). Options arrive as plain objects and are decoded natively (`ios/Core/Options.swift`,
`android/.../Options.kt`), which is where the documented defaults live: keep them in step with the JSDoc in
`src/types.ts`.

**The fast path is JavaScript in front of native.** `src/translator.ts` puts `translateAsync`, `translateBatchAsync`
and `prepareAsync` on the native class's prototype:
- `translateAsync` gathers single texts per translator for the rest of the current task and sends them as one batch in
  a `queueMicrotask` (React runs a screen's row effects in one task). Never a timer.
- `src/cache.ts` (`TranslationCache`) answers cached texts at once, dedupes a text asked for twice (also across calls
  still running, through `pending`), sends the rest as one batch and settles each text's promise on its own.
- The native batch (`translateNativeAsync(texts, batch)`) returns an outcome per text (a result, or `{error}`) and, with
  more than one text, also emits a `translated` event (`{batch, index, outcome}`) for each the moment it's done; the
  first of event or return settles it. A batch never fails as a whole for one text.
- `useTranslation` reads the cache while rendering (a cached text renders complete, with no second render) and retries
  a `not-installed` text when `src/downloads.ts` says a download (or a `prepareAsync`) succeeded.

**One core per platform, the same rules.** `TranslatorCore` (`ios/Core/TranslatorCore.swift`,
`android/.../TranslatorCore.kt`): blank texts and texts already in the target language come back untouched
(`engine: null`, `LanguageTags.sameLanguage`: same primary language, Chinese scripts apart); without `from` each text
is identified (Natural Language / ML Kit language-id); texts are grouped by language and each group is one batch on its
engine, the groups concurrently; an `EngineRouter` picks the engine that already has the pair, else the first that
can download it, and the core remembers it per language. `TextLines` (both platforms, same tests) splits a text into
lines and breaks for ML Kit, which loses line breaks.

## iOS (`ios/`)

`Core/` is plain Swift over Foundation, NaturalLanguage and Translation, compiled by the pod and by the SwiftPM package
in `Tests/` (`yarn test:ios`, macOS 26: the same Translation framework; translating needs the languages downloaded on
the Mac, otherwise those tests skip). The module layer (`*.swift` at the top) imports ExpoModulesCore and UIKit.

- **`AppleEngine`** (iOS 18): `LanguageAvailability` for statuses (installed pairs remembered, so a batch doesn't pay
  a round trip to the translation service), `translate(batch:)` for batches (an `AsyncSequence`, reported as it
  goes), `prepareTranslation()` for downloads. Strategy `highFidelity` from iOS 26.4. Responses' languages are
  `minimalIdentifier`s (`en`, `en-GB`, `zh-TW`).
- **Sessions** (`AppleSessionProvider`): `InstalledSessions` (Core, iOS 26) makes `TranslationSession(installedSource:)`
  per pair, no UI, installed languages only. `HostedSessions` (`HostedSessions.swift`) is the only way before iOS 26
  and for downloads: a one-point invisible `UIHostingController` over the top view controller, whose
  `translationTask` closure serves a queue of jobs one at a time (Apple fatal-errors when a session is used after its
  view goes), torn down after 20 s idle, or after 10 s if no session ever arrives. `AppSessions` picks between them.
- **The simulator:** Apple's framework calls every pair unsupported there (measured on iOS 26.5), so `Engines.all`
  leaves Apple out in the simulator and availability says `simulator`.
- **ML Kit** (`MLKit/MLKitEngine.swift`) is compiled only with `EXPO_TRANSLATION_MLKIT`: the podspec reads
  `expo-translation.mlkit` from `Podfile.properties.json` (the plugin writes it; `EXPO_TRANSLATION_MLKIT=1` overrides),
  adds `GoogleMLKit/Translate` and excludes arm64 from simulator builds (ML Kit has no such slice; its own podspec
  excludes it for the app too). Mind `MLKitTranslate.TranslatorOptions` vs the Core's `TranslatorOptions`.
- **`TranslationSheet`** (iOS 17.4): `translationPresentation` on a view at the window's centre; resolves one main-queue
  turn after dismissal so "Replace with Translation" lands first.
- Swift 5.9 language mode (podspec); `NSLock` is not reentrant, so read a locked value before taking the same lock.

## Android (`android/`)

- **`MLKitEngine`**: `Translation.getClient` per pair, the last three kept (their models are in memory, 30 to 150 MB
  each) and closed when evicted; `RemoteModelManager` for downloaded models (English is built in); every line of every
  text sent at once (ML Kit queues them). `Task.await()` resumes on the completing thread, never hopping to main.
- **`MLKitIdentifier`**: bundled language-id (`com.google.mlkit:language-id`), one client per process, threshold 0.01
  so there are candidates beyond the winner; `und` is dropped.
- Events go out through `appContext.mainQueue` (as in expo-speech).
- JVM tests: `yarn test:android` (needs the example's prebuilt `android/`).

## Rules

- Shared options at the top, iOS-only ones under `ios`. `wifiOnly` is ML Kit's (both platforms), so it's shared.
- Docs copy (README, the JSDoc in `src/types.ts`, changesets) has no em dashes.
- `yarn lint`, `yarn test`, `yarn test:ios`, `yarn test:android`, `yarn pack:check` before a release.
