# example

The example app for `@hzblj/expo-translation`: other countries' Wikipedias translated on the device, a playground and
the languages. Built from `@hzblj/kara-ui` like every hzblj example. Private; never published.

| Path | What it is |
| --- | --- |
| `app/(tabs)/` | Native tabs (`Tabs` from `@hzblj/kara-ui/router`), each a stack with a large title: World, Translate, Languages. Route files only re-export a screen from `src/`. |
| `src/world/` | Fifteen Wikipedias' featured (or most-read) article of the day (`wikipedia.ts`, Wikimedia's feed API with a user agent naming the app: the default one gets a 403), each card translating its title and paragraph with `useTranslation` and `download: false`, offering the download when a language is missing. |
| `src/translate/` | Typed text, its language identified as you go, translated into the target; Apple's sheet on iOS; a batch of 24 German sentences with its first and last times (measured in `onResult`, the screen redrawn once a frame). |
| `src/languages/` | Availability, and every language with its status into the target: download, or delete (ML Kit) behind kara's destructive `Alert`. |
| `src/target.tsx` | The target language every tab shares: the device's language when an engine translates into it, English otherwise. |
| `src/ui/` | `Page`, `Section`, `TabStack`, and `translation-meta.tsx` (the engine, time and cache pills). |
| `assets/icons/` | Material Symbols SVGs, turned into native assets by kara's plugin at prebuild. |
| `assets/icon.png`, `assets/adaptive-icon.png` | The app icon: two speech bubbles from plain shapes, the front one with two lines of text, on an indigo gradient (iOS); the bubbles alone on `ICON_BACKGROUND` (Android). |

**kara's `Picker` brings its own host** on both platforms: it goes straight into the React Native tree. In an `Island`
it renders at zero height on iOS and breaks the Island's layout on Android.

**No Wikipedia content in the repo.** The articles and their pictures are fetched from Wikimedia while the app runs.

**The scene life cycle** (`withSceneLifecycle` in `app.config.ts`): iOS 27 stops an app built with its SDK at launch
unless it adopts scenes, and Expo 57's template doesn't. The plugin registers Expo's `ExpoAppSceneDelegate` in
Info.plist and leaves the app delegate only providing the React Native factory, as Expo 58's template does. Remove it
with the move to Expo 58.

**Native changes need a rebuild**: `yarn prebuild` (it builds the package first), then a native run. `MLKIT=1 yarn
prebuild` bundles ML Kit on iOS (Czech and the other languages Apple lacks); that build runs on a device or an x86_64
simulator. Apple's framework doesn't translate in the simulator.
