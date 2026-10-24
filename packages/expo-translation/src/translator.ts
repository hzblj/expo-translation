import {type BatchTranslate, type NativeOutcome, translationCache} from './cache'
import {languagesChanged} from './downloads'
import {ExpoTranslation, type Translator} from './ExpoTranslationModule'
import type {BatchOptions, TranslationResult} from './types'

type Report = (index: number, outcome: NativeOutcome) => void

const ignore = () => undefined

/** Each translator's batches still running, by id, waiting for their texts' `translated` events. */
const reporting = new WeakMap<Translator, Map<number, Report>>()
let nextBatch = 1

/**
 * The native batch, with each text's outcome reported as the engine has it: Apple's batch translation and ML Kit
 * both finish texts one by one, and a row should not wait for the slowest text of its screen.
 */
const nativeBatch =
  (translator: Translator): BatchTranslate =>
  async (texts, report) => {
    let batches = reporting.get(translator)

    if (!batches) {
      const listening = new Map<number, Report>()

      translator.addListener('translated', ({batch, index, outcome}) => listening.get(batch)?.(index, outcome))
      reporting.set(translator, listening)
      batches = listening
    }
    const batch = nextBatch++

    batches.set(batch, report)
    try {
      return await translator.translateNativeAsync(texts, batch)
    } finally {
      batches.delete(batch)
    }
  }

const nativePrepare = ExpoTranslation.Translator.prototype.prepareAsync

/** Native, then a word to every translation waiting for a language: preparing may have downloaded it. */
ExpoTranslation.Translator.prototype.prepareAsync = async function prepareAsync(this: Translator): Promise<void> {
  await nativePrepare.call(this)
  languagesChanged()
}

/**
 * `translateAsync` and `translateBatchAsync` live in JavaScript, on the native class's prototype, in front of the
 * cache: only what was never translated with this configuration reaches the native side.
 */
ExpoTranslation.Translator.prototype.translateBatchAsync = function translateBatchAsync(
  this: Translator,
  texts: string[],
  {onResult}: BatchOptions = {}
): Promise<TranslationResult[]> {
  const promises = translationCache.translate(this.configurationKey, texts, nativeBatch(this))

  if (onResult) {
    promises.forEach((promise, index) => {
      // A failure reaches the caller through `Promise.all` below.
      promise.then(result => onResult(result, index), ignore)
    })
  }
  return Promise.all(promises)
}

type Waiting = {text: string; resolve(result: TranslationResult): void; reject(error: unknown): void}

/** Single texts asked of each translator in the current task, sent on together. */
const gathering = new WeakMap<Translator, Waiting[]>()

/**
 * One text, gathered with every other text asked of this translator in the same task (React runs the effects of a
 * whole screen of rows, each with its `useTranslation`, in one go) and sent as one batch when the task ends: a
 * microtask, so nothing waits for a timer. Each text still settles on its own, as soon as it is translated.
 */
ExpoTranslation.Translator.prototype.translateAsync = function translateAsync(
  this: Translator,
  text: string
): Promise<TranslationResult> {
  return new Promise((resolve, reject) => {
    const waiting = gathering.get(this)

    if (waiting) {
      waiting.push({reject, resolve, text})
      return
    }

    const batch: Waiting[] = [{reject, resolve, text}]

    gathering.set(this, batch)
    queueMicrotask(() => {
      gathering.delete(this)
      const promises = translationCache.translate(
        this.configurationKey,
        batch.map(item => item.text),
        nativeBatch(this)
      )

      batch.forEach((item, index) => {
        promises[index]?.then(item.resolve, item.reject)
      })
    })
  })
}
