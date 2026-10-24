import './translator'

import {ExpoTranslation, type Translator as TranslatorInstance} from './ExpoTranslationModule'

/** Translates into one language: `new Translator(options)`, or `useTranslator`. */
export const Translator = ExpoTranslation.Translator
export type Translator = TranslatorInstance
export {
  type LanguageStatusSnapshot,
  type TranslationSnapshot,
  useLanguageStatus,
  useTranslation,
  useTranslator,
} from './hooks'
export {Translation} from './Translation'
export type * from './types'
