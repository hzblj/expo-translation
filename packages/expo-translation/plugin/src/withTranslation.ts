import {type ConfigPlugin, withPodfileProperties} from 'expo/config-plugins'

export type TranslationPluginOptions = {
  ios?: {
    /**
     * Bundle Google's ML Kit on iOS too, for the languages Apple's Translation framework does not translate (Czech,
     * Slovak, Hungarian, Romanian, Greek and others): `auto` translators use it where Apple cannot. It adds the ML Kit
     * frameworks to the app, and since they have no arm64 simulator slice, the app's simulator builds leave arm64
     * out. Needs a new prebuild.
     * @default false
     */
    mlkit?: boolean
  }
}

/** The Podfile property the package's podspec reads to add ML Kit. */
export const MLKIT_PROPERTY = 'expo-translation.mlkit'

/** Records whether ML Kit is bundled on iOS, for the podspec to read at `pod install`. */
export const setPodfileProperties = (
  properties: Record<string, string>,
  options: TranslationPluginOptions
): Record<string, string> => ({...properties, [MLKIT_PROPERTY]: String(options.ios?.mlkit === true)})

/**
 * The optional parts of expo-translation: ML Kit on iOS. Nothing else needs configuring; Android's ML Kit and Apple's
 * framework need no permission or entitlement.
 */
export const withTranslation: ConfigPlugin<TranslationPluginOptions | void> = (config, options) =>
  withPodfileProperties(config, podfile => {
    podfile.modResults = setPodfileProperties(podfile.modResults, options ?? {})
    return podfile
  })
