import type {ExpoConfig} from 'expo/config'

// Not "Expo Translation": the generated Xcode target would be `ExpoTranslation`, the Swift module of the package.
const NAME = 'Translation Example'
const BUNDLE_ID = 'com.hzblj.expotranslation.example'
// `MLKIT=1 yarn prebuild` bundles ML Kit on iOS too, for Czech and the other languages Apple's framework lacks. Its
// frameworks have no arm64 simulator slice, so that build runs on a device (or an x86_64 simulator).
const MLKIT = process.env.MLKIT === '1'
// The middle of the iOS icon's indigo: what the Android icon's bubbles sit on.
const ICON_BACKGROUND = '#3f51e8'

export default {
  android: {
    adaptiveIcon: {
      backgroundColor: ICON_BACKGROUND,
      foregroundImage: './assets/adaptive-icon.png',
    },
    package: BUNDLE_ID,
  },
  experiments: {
    typedRoutes: true,
  },
  icon: './assets/icon.png',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
  },
  name: NAME,
  orientation: 'portrait',
  plugins: [
    'expo-router',
    // The example's icons (Material Symbols): every SVG in assets/icons becomes a native asset on both platforms, and
    // its name a type in native-icons.d.ts.
    ['@hzblj/kara-ui', {icons: {source: './assets/icons'}}],
    // Built from packages/expo-translation, which is why `yarn prebuild` builds it first.
    ['@hzblj/expo-translation', {ios: {mlkit: MLKIT}}],
    // The scene life cycle, which apps built with the iOS 27 SDK need or they stop at launch: Expo 57's template has
    // none, so React Native starts from Expo's scene delegate instead. Remove it with the move to Expo 58.
    ['expo-build-properties', {ios: {enableSceneSupport: true}}],
  ],
  scheme: 'translation-example',
  slug: 'expo-translation-example',
  userInterfaceStyle: 'automatic',
  version: '1.0.0',
} satisfies ExpoConfig
