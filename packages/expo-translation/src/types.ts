/**
 * What translates:
 * - `apple`: Apple's Translation framework (iOS 18 and later, on a device).
 * - `mlkit`: Google's ML Kit, on Android, and on iOS when the config plugin's `ios.mlkit` bundles it.
 */
export type TranslationEngine = 'apple' | 'mlkit'

/** Whether a pair of languages can be translated here, and what it takes. */
export type LanguageStatus =
  /** Both languages are on the device: translating needs nothing more. */
  | 'installed'
  /** Supported, but a language still has to be downloaded first. */
  | 'downloadable'
  /** No engine on this device translates the pair. */
  | 'unsupported'

/** A language as a BCP 47 tag: `cs`, `en-GB`, `pt-PT`, `zh-Hant`. */
export type LanguageTag = string

export type LanguagePair = {
  /** The language of the text. */
  from: LanguageTag
  /** The language to translate it into. */
  to: LanguageTag
}

export type PairStatus = {
  status: LanguageStatus
  /** The engine that would translate the pair, or `null` when none does. */
  engine: TranslationEngine | null
}

/** A language an engine translates. */
export type TranslationLanguage = {
  /** The engine's own tag for it: `en`, `en-GB`, `pt-PT`, `zh-TW`. */
  language: LanguageTag
  /**
   * Its name in the device's language ("Czech", "English (United Kingdom)"), from the platform: Hermes has no
   * `Intl.DisplayNames`.
   */
  name: string
  /** The engine that translates it. A language both engines know is listed once, as Apple's. */
  engine: TranslationEngine
}

export type IdentifiedLanguage = {
  language: LanguageTag
  /** From 0 to 1. */
  confidence: number
}

/** The language a text is written in, as far as the platform can tell. */
export type LanguageIdentification = {
  /** The most likely language, or `null` when the text says too little. */
  language: LanguageTag | null
  /** How sure the platform is of `language`, from 0 to 1. */
  confidence: number
  /** The likeliest languages, most likely first. */
  candidates: IdentifiedLanguage[]
}

/** Which engine an iOS translator uses. */
export type IOSEngineChoice =
  /** The engine that already has both languages; otherwise Apple's, then ML Kit when it is bundled. */
  | 'auto'
  | 'apple'
  /** Needs the config plugin's `ios.mlkit`. */
  | 'mlkit'

/**
 * iOS 26.4 and later, Apple's engine:
 * - `lowLatency`: the traditional translation models, fast and frugal.
 * - `highFidelity`: Apple Intelligence's model, more fluent where the device has it (and nothing to download); the
 *   traditional models elsewhere.
 */
export type TranslationStrategy = 'lowLatency' | 'highFidelity'

export type TranslatorIOSOptions = {
  /** @default 'auto' */
  engine?: IOSEngineChoice
  /** @default 'lowLatency' */
  strategy?: TranslationStrategy
}

export type TranslatorOptions = {
  /**
   * The language of the text. When unset, each text's language is identified first (`identifyLanguageAsync`), and a
   * text already in `to` comes back as it is.
   */
  from?: LanguageTag
  /** The language to translate into. */
  to: LanguageTag
  /**
   * Download a missing language when it is first needed. Apple's engine asks the user in its own sheet; ML Kit
   * downloads the model (about 30 MB a language) without asking. When `false`, a missing language fails the
   * translation with `not-installed`.
   * @default true
   */
  download?: boolean
  /**
   * ML Kit: download models over Wi-Fi only. Apple's downloads are the system's.
   * @default false
   */
  wifiOnly?: boolean
  ios?: TranslatorIOSOptions
}

export type TranslationResult = {
  /** The translation. The text itself when it was already in the target language. */
  text: string
  /** The text as it was given. */
  sourceText: string
  /** The language it was translated from: the one given as `from`, or the one identified. */
  sourceLanguage: LanguageTag
  targetLanguage: LanguageTag
  /** What translated it; `null` when the text was already in the target language and nothing had to. */
  engine: TranslationEngine | null
  /** Whether it came from the cache, without translating anything. */
  fromCache: boolean
}

export type BatchOptions = {
  /** Called with each translation as soon as it is done, with its index in the batch. */
  onResult?: (result: TranslationResult, index: number) => void
}

export type PairOptions = LanguagePair & {
  /** ML Kit: download over Wi-Fi only. */
  wifiOnly?: boolean
  ios?: TranslatorIOSOptions
}

export type TranslationAvailability = {
  /** Whether anything translates on this device. */
  available: boolean
  /** The engines this build has, in the order `auto` tries them. */
  engines: TranslationEngine[]
  /**
   * Why nothing translates, when `available` is false:
   * - `simulator`: Apple's framework translates on devices only (and ML Kit is not bundled).
   * - `os`: iOS before 18, and ML Kit is not bundled.
   */
  reason: 'simulator' | 'os' | null
  /** iOS 17.4 and later: `presentTranslationAsync` shows Apple's translation sheet. */
  translationSheet: boolean
  /**
   * Whether downloaded languages can be listed and deleted from the app: ML Kit's can. Apple's belong to the system
   * (Settings, Apps, Translate) and are only ever downloaded with the user's consent.
   */
  manageDownloads: boolean
}

export type TranslationErrorCode =
  /** No engine on this device translates the pair. */
  | 'unsupported-language'
  /** A language is not downloaded and the translator may not download it (`download: false`). */
  | 'not-installed'
  /** The user declined Apple's download sheet, or dismissed it while the languages were downloading. */
  | 'download-declined'
  /** `from` was not given and the text's language could not be told. */
  | 'unable-to-identify'
  /** Nothing translates on this device: see `TranslationAvailability.reason`. */
  | 'unavailable'
  /** A model could not be downloaded. */
  | 'network'
  | 'cancelled'
  | 'unknown'

/** Errors thrown by the module carry one of these codes. */
export type TranslationError = Error & {code: TranslationErrorCode}

export type PresentTranslationOptions = {
  /**
   * Offer "Replace with Translation" in the sheet: the promise then resolves with the translation when the user
   * picks it.
   * @default false
   */
  replace?: boolean
}
