import type {TranslationError, TranslationErrorCode, TranslationResult} from './types'

/** One translation as the native side answers it: the cache adds `fromCache`. */
export type NativeTranslationResult = Omit<TranslationResult, 'fromCache'>

/** One text's outcome in a native batch: a batch never fails as a whole for one text's sake. */
export type NativeOutcome = NativeTranslationResult | {error: {code: TranslationErrorCode; message: string}}

/**
 * Sends texts to the engine. `report` may be called with each text's outcome as soon as the engine has it; the
 * returned outcomes settle whatever was not reported.
 */
export type BatchTranslate = (
  texts: string[],
  report: (index: number, outcome: NativeOutcome) => void
) => Promise<NativeOutcome[]>

export const translationError = ({code, message}: {code: TranslationErrorCode; message: string}): TranslationError =>
  Object.assign(new Error(message), {code})

const ignore = () => undefined

type Deferred = {
  promise: Promise<NativeTranslationResult>
  settled: boolean
  resolve(result: NativeTranslationResult): void
  reject(error: unknown): void
}

const deferred = (): Deferred => {
  const one = {settled: false} as Deferred

  one.promise = new Promise<NativeTranslationResult>((resolve, reject) => {
    one.resolve = result => {
      one.settled = true
      resolve(result)
    }
    one.reject = error => {
      one.settled = true
      reject(error)
    }
  })
  // Settled by the batch; the handler only keeps an unawaited rejection from being reported as unhandled.
  one.promise.catch(ignore)
  return one
}

/**
 * Translations kept for the app's lifetime, least recently used out first, keyed by a translator's configuration and
 * the text. A list that scrolls back, or a second component with the same text, is answered at once.
 */
export class TranslationCache {
  private readonly entries = new Map<string, NativeTranslationResult>()
  private readonly pending = new Map<string, Promise<NativeTranslationResult>>()

  constructor(public limit = 1000) {}

  private static key(configuration: string, text: string) {
    return `${configuration}\u0000${text}`
  }

  get size() {
    return this.entries.size
  }

  /** The cached translation, marked `fromCache`, and now the most recently used. Synchronous. */
  get(configuration: string, text: string): TranslationResult | undefined {
    const key = TranslationCache.key(configuration, text)
    const entry = this.entries.get(key)

    if (!entry) {
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return {...entry, fromCache: true}
  }

  set(configuration: string, text: string, result: NativeTranslationResult) {
    if (this.limit <= 0) {
      return
    }
    const key = TranslationCache.key(configuration, text)

    this.entries.delete(key)
    this.entries.set(key, result)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value

      if (oldest === undefined) {
        break
      }
      this.entries.delete(oldest)
    }
  }

  clear() {
    this.entries.clear()
  }

  /**
   * A promise per text, in order: cached ones resolved at once, a text asked for twice (here, or by a call still
   * running) translated once, and the rest handed to `translate` as one batch. Each promise settles as soon as the
   * engine reports its text. A text that fails rejects its own promise only; failures are not cached.
   */
  translate(configuration: string, texts: string[], translate: BatchTranslate): Promise<TranslationResult>[] {
    const cached = texts.map(text => this.get(configuration, text))
    const batch = new Map<string, Deferred>()
    const running = new Map<string, Promise<NativeTranslationResult>>()

    texts.forEach((text, index) => {
      if (cached[index] || running.has(text)) {
        return
      }
      const key = TranslationCache.key(configuration, text)
      const earlier = this.pending.get(key)

      if (earlier) {
        running.set(text, earlier)
        return
      }
      const one = deferred()

      batch.set(text, one)
      running.set(text, one.promise)
      this.pending.set(key, one.promise)
    })

    if (batch.size > 0) {
      const sent = [...batch.keys()]
      const settle = (text: string | undefined, outcome: NativeOutcome | Error) => {
        const one = text === undefined ? undefined : batch.get(text)

        if (!one || one.settled || text === undefined) {
          return
        }
        this.pending.delete(TranslationCache.key(configuration, text))
        if (outcome instanceof Error) {
          one.reject(outcome)
        } else if ('error' in outcome) {
          one.reject(translationError(outcome.error))
        } else {
          this.set(configuration, text, outcome)
          one.resolve(outcome)
        }
      }

      translate(sent, (index, outcome) => settle(sent[index], outcome)).then(
        outcomes =>
          sent.forEach((text, index) =>
            settle(text, outcomes[index] ?? new Error('expo-translation: a translation went missing'))
          ),
        (error: Error) => {
          for (const text of sent) {
            settle(text, error)
          }
        }
      )
    }

    return texts.map((text, index) => {
      const hit = cached[index]

      if (hit) {
        return Promise.resolve(hit)
      }
      return (running.get(text) as Promise<NativeTranslationResult>).then(result => ({...result, fromCache: false}))
    })
  }
}

export const translationCache = new TranslationCache()
