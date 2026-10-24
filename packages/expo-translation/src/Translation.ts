import {translationCache} from './cache'
import {languagesChanged} from './downloads'
import {ExpoTranslation, type Translator} from './ExpoTranslationModule'
import {optionsKey} from './options'
import type {
  BatchOptions,
  LanguageIdentification,
  LanguagePair,
  PairOptions,
  PairStatus,
  PresentTranslationOptions,
  TranslationAvailability,
  TranslationLanguage,
  TranslationResult,
  TranslatorOptions,
} from './types'

/** The translators `Translation.translateAsync` keeps, one per configuration, alive for the app's lifetime. */
const shared = new Map<string, Translator>()

/** The translator kept for these options, made on first use. */
export const sharedTranslator = (options: TranslatorOptions): Translator => {
  const key = optionsKey(options)
  let translator = shared.get(key)

  if (!translator) {
    translator = new ExpoTranslation.Translator(options)
    shared.set(key, translator)
  }
  return translator
}

/**
 * What the device translates and in which languages, the languages' downloads, language identification and one-off
 * translations. Translating many texts with one configuration is a `Translator`'s job (`useTranslator`).
 */
export const Translation = {
  /** Forgets every cached translation. */
  clearCache: (): void => translationCache.clear(),

  /**
   * ML Kit: deletes a downloaded language model and resolves `true`. Apple's languages belong to the system and stay:
   * `false`. English is built into ML Kit and stays too.
   */
  deleteDownloadedLanguageAsync: (language: string): Promise<boolean> =>
    ExpoTranslation.deleteDownloadedLanguageAsync(language),

  /**
   * Downloads what the pair needs. Apple's engine shows its own sheet, where the user agrees to the download and
   * follows it, and resolves once the languages are in (rejecting with `download-declined` when the user says no).
   * ML Kit downloads both models without asking.
   */
  downloadAsync: async ({from, ios, to, wifiOnly = false}: PairOptions): Promise<void> => {
    await ExpoTranslation.downloadAsync({from, ios: ios ?? {}, to, wifiOnly})
    languagesChanged()
  },

  /** Which engines this build has and whether anything translates on this device. */
  getAvailabilityAsync: (): Promise<TranslationAvailability> => ExpoTranslation.getAvailabilityAsync(),

  /** ML Kit's downloaded language models. Apple's downloads are the system's and are not listed. */
  getDownloadedLanguagesAsync: (): Promise<string[]> => ExpoTranslation.getDownloadedLanguagesAsync(),

  /** Whether the pair translates here, which engine would do it and whether a language still has to download. */
  getStatusAsync: ({from, ios, to}: LanguagePair & Pick<PairOptions, 'ios'>): Promise<PairStatus> =>
    ExpoTranslation.getStatusAsync({from, ios: ios ?? {}, to}),

  /** Every language some engine translates here, with its name in the device's language. */
  getSupportedLanguagesAsync: (): Promise<TranslationLanguage[]> => ExpoTranslation.getSupportedLanguagesAsync(),

  /**
   * The language a text is written in: Natural Language on iOS, ML Kit's language identification on Android. A
   * sentence or two is enough; a single word often is not.
   */
  identifyLanguageAsync: (
    text: string,
    {maxCandidates = 3}: {maxCandidates?: number} = {}
  ): Promise<LanguageIdentification> => ExpoTranslation.identifyLanguageAsync(text, maxCandidates),

  /**
   * A language's name in the device's language, starting with a capital ("Czech", "English (United Kingdom)";
   * "Čeština" on a Czech phone), from the platform's locale data, for any tag, translatable or not. Synchronous: Hermes has no
   * `Intl.DisplayNames`, and a name should not wait for a promise.
   */
  languageName: (language: string): string => ExpoTranslation.languageName(language),

  /**
   * iOS 17.4 and later: Apple's translation sheet over the app, the system's own UI with its language pickers. It
   * resolves with the translation when the user picks "Replace with Translation" (offered with `replace`), and with
   * `null` when the sheet is closed. Android has no such sheet and resolves `null` at once.
   */
  presentTranslationAsync: (text: string, {replace = false}: PresentTranslationOptions = {}): Promise<string | null> =>
    ExpoTranslation.presentTranslationAsync(text, replace),

  /** Translates one text with a translator kept for these options. */
  translateAsync: (text: string, options: TranslatorOptions): Promise<TranslationResult> =>
    sharedTranslator(options).translateAsync(text),

  /** Translates several texts as one batch, with a translator kept for these options. */
  translateBatchAsync: (
    texts: string[],
    {onResult, ...options}: TranslatorOptions & BatchOptions
  ): Promise<TranslationResult[]> => sharedTranslator(options).translateBatchAsync(texts, {onResult}),
}
