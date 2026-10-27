# @hzblj/expo-translation

## 0.1.4

### Patch Changes

- [`cd71af0`](https://github.com/hzblj/expo-translation/commit/cd71af03b7997c3a9f5ab59e62fdb1c1bd805713) Thanks [@hzblj](https://github.com/hzblj)! - The README shows the example app on iOS too, translating with Apple's framework.

## 0.1.3

### Patch Changes

- [`2ce3c90`](https://github.com/hzblj/expo-translation/commit/2ce3c90a7e3805f9b11dd6bc082b0824b7bfe4fa) Thanks [@hzblj](https://github.com/hzblj)! - The README shows the example app on Android.

## 0.1.2

### Patch Changes

- [`77355c5`](https://github.com/hzblj/expo-translation/commit/77355c5d7b9c307f3ec78afd5c37d0e00d08256f) Thanks [@hzblj](https://github.com/hzblj)! - The LICENSE is the complete MIT license, with the limitation of liability it was missing.

## 0.1.1

### Patch Changes

- [`ca7e22c`](https://github.com/hzblj/expo-translation/commit/ca7e22c411040f416ba70f85d811f0053db53924) Thanks [@hzblj](https://github.com/hzblj)! - The README links to the other libraries, at libraries.janblazej.dev.

## 0.1.0

### Minor Changes

- [`b4b1fe7`](https://github.com/hzblj/expo-translation/commit/b4b1fe732426bdc526abb584da2b49116c8926d7) Thanks [@hzblj](https://github.com/hzblj)! - On-device translation for Expo on the platforms' own engines: Apple's Translation framework on iOS 18 (installed languages without any view on iOS 26, Apple Intelligence's model with `highFidelity` on iOS 26.4), Google's ML Kit on Android, and ML Kit on iOS too for the languages Apple lacks (Czech, Slovak, Hungarian, Romanian, Greek and others) when the config plugin's `ios.mlkit` bundles it. Language status, downloads and deletion, language identification, and a `Translator` that keeps its engine loaded. Texts asked for in the same moment reach the engine as one batch, each settles the moment it is translated, and every translation is cached, so a list renders a translated row complete on its first render. `useTranslation`, `useTranslator`, `useLanguageStatus`, a synchronous `languageName` and Apple's translation sheet.
