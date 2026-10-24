# @hzblj/expo-translation

## 0.1.0

### Minor Changes

- [`b4b1fe7`](https://github.com/hzblj/expo-translation/commit/b4b1fe732426bdc526abb584da2b49116c8926d7) Thanks [@hzblj](https://github.com/hzblj)! - On-device translation for Expo on the platforms' own engines: Apple's Translation framework on iOS 18 (installed languages without any view on iOS 26, Apple Intelligence's model with `highFidelity` on iOS 26.4), Google's ML Kit on Android, and ML Kit on iOS too for the languages Apple lacks (Czech, Slovak, Hungarian, Romanian, Greek and others) when the config plugin's `ios.mlkit` bundles it. Language status, downloads and deletion, language identification, and a `Translator` that keeps its engine loaded. Texts asked for in the same moment reach the engine as one batch, each settles the moment it is translated, and every translation is cached, so a list renders a translated row complete on its first render. `useTranslation`, `useTranslator`, `useLanguageStatus`, a synchronous `languageName` and Apple's translation sheet.
