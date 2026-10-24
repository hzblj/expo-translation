import {useReleasingSharedObject} from 'expo-modules-core'
import {useCallback, useEffect, useState} from 'react'

import {translationCache} from './cache'
import {onLanguagesChanged} from './downloads'
import {ExpoTranslation, type Translator} from './ExpoTranslationModule'
import {optionsKey} from './options'
import {sharedTranslator, Translation} from './Translation'
import type {
  LanguagePair,
  PairStatus,
  TranslationError,
  TranslationResult,
  TranslatorIOSOptions,
  TranslatorOptions,
} from './types'

/**
 * A translator for these options, released when the component unmounts or the options change. Options are compared
 * by value, so an inline object is fine.
 */
export const useTranslator = (options: TranslatorOptions): Translator =>
  useReleasingSharedObject(() => new ExpoTranslation.Translator(options), [optionsKey(options)])

type TranslationState = {
  /** The translation, or `null` until there is one. */
  text: string | null
  result: TranslationResult | null
  error: TranslationError | null
  /** Whether a translation is on its way. */
  translating: boolean
}

export type TranslationSnapshot = TranslationState & {
  /**
   * Translates again after a failure. A `not-installed` one retries by itself once `Translation.downloadAsync` or a
   * translator's `prepareAsync` succeeds anywhere in the app.
   */
  retry(): void
}

const idle: TranslationState = {error: null, result: null, text: null, translating: false}
const waiting: TranslationState = {...idle, translating: true}

const fromCache = (translator: Translator | null, text: string | null | undefined): TranslationState | null => {
  const cached = text && translator ? translationCache.get(translator.configurationKey, text) : undefined

  return cached ? {error: null, result: cached, text: cached.text, translating: false} : null
}

/**
 * Translates a text and re-renders with the translation, with a translator from `useTranslator` or with options (a
 * translator kept for them is shared by every component that passes the same). A text translated before with the same
 * configuration is there on the first render, without another, so a list that scrolls back never flickers. Texts asked
 * for in the same moment, by a whole screen of rows, reach the engine as one batch. A `null` text or translator gives
 * an idle snapshot.
 */
export const useTranslation = (
  text: string | null | undefined,
  using: Translator | TranslatorOptions | null
): TranslationSnapshot => {
  const translator = !using || using instanceof ExpoTranslation.Translator ? using : sharedTranslator(using)
  const key = text && translator ? `${translator.configurationKey}\u0000${text}` : null
  const [state, setState] = useState(() => ({key, value: fromCache(translator, text) ?? (key ? waiting : idle)}))
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(current => current + 1), [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the text and the translator.
  useEffect(() => {
    if (!key || !text || !translator) {
      setState(current => (current.key === key ? current : {key, value: idle}))
      return
    }
    const cached = fromCache(translator, text)

    if (cached) {
      setState(current => (current.key === key && current.value.result ? current : {key, value: cached}))
      return
    }

    let current = true

    setState({key, value: waiting})
    translator.translateAsync(text).then(
      result => {
        if (current) {
          setState({key, value: {error: null, result, text: result.text, translating: false}})
        }
      },
      (error: TranslationError) => {
        if (current) {
          setState({key, value: {...idle, error}})
        }
      }
    )

    return () => {
      current = false
    }
  }, [key, attempt])

  // A new text or translator renders what the cache has for it at once, not the last text's translation.
  const value = state.key === key ? state.value : (fromCache(translator, text) ?? (key ? waiting : idle))
  const missingLanguage = value.error?.code === 'not-installed'

  // Waiting for a language: once a download anywhere succeeds, try again.
  useEffect(() => (missingLanguage ? onLanguagesChanged(retry) : undefined), [missingLanguage, retry])

  return {...value, retry}
}

export type LanguageStatusSnapshot = PairStatus & {
  /** Whether the status is being read. */
  loading: boolean
  /** Reads the status again, after a download for example. */
  refresh(): Promise<void>
}

/** Whether a pair translates here, which engine would do it and whether something still has to download. */
export const useLanguageStatus = (
  pair: (LanguagePair & {ios?: TranslatorIOSOptions}) | null
): LanguageStatusSnapshot => {
  const [status, setStatus] = useState<PairStatus & {loading: boolean}>({
    engine: null,
    loading: true,
    status: 'unsupported',
  })
  const key = pair ? optionsKey(pair) : null

  const refresh = useCallback(async () => {
    if (!key) {
      setStatus({engine: null, loading: false, status: 'unsupported'})
      return
    }
    setStatus(current => ({...current, loading: true}))
    try {
      setStatus({...(await Translation.getStatusAsync(JSON.parse(key))), loading: false})
    } catch {
      setStatus({engine: null, loading: false, status: 'unsupported'})
    }
  }, [key])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {...status, refresh}
}
