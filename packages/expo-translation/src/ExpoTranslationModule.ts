import {type NativeModule, requireNativeModule, type SharedObject} from 'expo'

import type {NativeOutcome} from './cache'
import type {
  BatchOptions,
  LanguageIdentification,
  PairStatus,
  TranslationAvailability,
  TranslationLanguage,
  TranslationResult,
  TranslatorOptions,
} from './types'

type TranslatorEvents = {
  /** @hidden One text of a running native batch is done. */
  translated(event: {batch: number; index: number; outcome: NativeOutcome}): void
}

/**
 * Translates into one language, from one language or from whatever each text is written in. A native object shared
 * with JavaScript: keep one per configuration (`useTranslator` does) so its engine stays loaded.
 */
export declare class Translator extends SharedObject<TranslatorEvents> {
  constructor(options: TranslatorOptions)
  /** The language given as `from`, or `null` when each text's language is identified. */
  readonly from: string | null
  readonly to: string
  /** @hidden What a translation depends on besides the text: the cache's key. */
  readonly configurationKey: string
  /**
   * Gets the languages ready ahead of the first translation: downloads what is missing (unless `download` is off;
   * Apple's engine asks the user) and loads the engine. Without `from`, only the target language.
   */
  prepareAsync(): Promise<void>
  /**
   * Translates one text, from the cache when it was translated before. Texts asked for in the same moment reach the
   * engine as one batch.
   */
  translateAsync(text: string): Promise<TranslationResult>
  /**
   * Translates several texts as one batch and resolves with all of them, in order. `onResult` gets each one as soon
   * as it is done. Rejects when any text fails.
   */
  translateBatchAsync(texts: string[], options?: BatchOptions): Promise<TranslationResult[]>
  /**
   * @hidden The native side of both, without the cache: an outcome per text, each also sent as a `translated` event
   * the moment it is done.
   */
  translateNativeAsync(texts: string[], batch: number): Promise<NativeOutcome[]>
}

declare class ExpoTranslationNativeModule extends NativeModule<Record<never, never>> {
  Translator: typeof Translator
  getAvailabilityAsync(): Promise<TranslationAvailability>
  getSupportedLanguagesAsync(): Promise<TranslationLanguage[]>
  getStatusAsync(options: object): Promise<PairStatus>
  downloadAsync(options: object): Promise<void>
  getDownloadedLanguagesAsync(): Promise<string[]>
  deleteDownloadedLanguageAsync(language: string): Promise<boolean>
  languageName(language: string): string
  identifyLanguageAsync(text: string, maxCandidates: number): Promise<LanguageIdentification>
  presentTranslationAsync(text: string, replace: boolean): Promise<string | null>
}

export const ExpoTranslation = requireNativeModule<ExpoTranslationNativeModule>('ExpoTranslation')
