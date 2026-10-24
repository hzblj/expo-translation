import assert from 'node:assert/strict'
import {test} from 'node:test'

import {type NativeOutcome, TranslationCache} from '../src/cache'
import {optionsKey} from '../src/options'

const KEY = 'de|en|auto|lowLatency'

const translated = (text: string): NativeOutcome => ({
  engine: 'apple',
  sourceLanguage: 'de',
  sourceText: text,
  targetLanguage: 'en',
  text: `en:${text}`,
})

/** A native batch that answers when told to, and records what it was sent. */
const engine = () => {
  const calls: string[][] = []
  const pending: {texts: string[]; report: (index: number, outcome: NativeOutcome) => void; finish(): void}[] = []
  const translate = (texts: string[], report: (index: number, outcome: NativeOutcome) => void) => {
    calls.push(texts)
    return new Promise<NativeOutcome[]>(resolve => {
      pending.push({finish: () => resolve(texts.map(translated)), report, texts})
    })
  }

  return {calls, pending, translate}
}

test('one batch for what is missing, results in order', async () => {
  const cache = new TranslationCache()
  const native = engine()
  const promises = cache.translate(KEY, ['a', 'b', 'a'], native.translate)

  assert.deepEqual(native.calls, [['a', 'b']])
  native.pending[0]?.finish()
  const results = await Promise.all(promises)

  assert.deepEqual(
    results.map(result => result.text),
    ['en:a', 'en:b', 'en:a']
  )
  assert.equal(results[0]?.fromCache, false)
})

test('cached texts come back marked and never reach the engine', async () => {
  const cache = new TranslationCache()
  const native = engine()

  cache.set(KEY, 'a', translated('a') as never)
  const [cached, fresh] = cache.translate(KEY, ['a', 'b'], native.translate)

  assert.deepEqual(native.calls, [['b']])
  assert.equal((await cached)?.fromCache, true)
  native.pending[0]?.finish()
  assert.equal((await fresh)?.text, 'en:b')
  assert.equal(cache.get(KEY, 'b')?.fromCache, true)
})

test('a text settles as soon as it is reported, before the batch ends', async () => {
  const cache = new TranslationCache()
  const native = engine()
  const [first, second] = cache.translate(KEY, ['a', 'b'], native.translate)
  let secondDone = false

  second?.then(() => {
    secondDone = true
  })
  native.pending[0]?.report(0, translated('a'))
  assert.equal((await first)?.text, 'en:a')
  await Promise.resolve()
  assert.equal(secondDone, false)
  native.pending[0]?.finish()
  assert.equal((await second)?.text, 'en:b')
})

test('a text still running is not sent twice', async () => {
  const cache = new TranslationCache()
  const native = engine()
  const [first] = cache.translate(KEY, ['a'], native.translate)
  const [again] = cache.translate(KEY, ['a'], native.translate)

  assert.equal(native.calls.length, 1)
  native.pending[0]?.finish()
  assert.equal((await first)?.text, 'en:a')
  assert.equal((await again)?.text, 'en:a')
})

test('a failing text rejects alone and is not cached', async () => {
  const cache = new TranslationCache()
  const promises = cache.translate(KEY, ['a', 'b'], async texts => [
    translated(texts[0] ?? ''),
    {error: {code: 'unsupported-language', message: 'nope'}},
  ])

  assert.equal((await promises[0])?.text, 'en:a')
  await assert.rejects(promises[1] as Promise<unknown>, {code: 'unsupported-language', message: 'nope'})
  assert.equal(cache.get(KEY, 'b'), undefined)
})

test('a batch that throws rejects every text in it, and the next call tries again', async () => {
  const cache = new TranslationCache()
  const [failed] = cache.translate(KEY, ['a'], async () => {
    throw new Error('engine gone')
  })

  await assert.rejects(failed as Promise<unknown>, /engine gone/)
  const [retried] = cache.translate(KEY, ['a'], async texts => texts.map(translated))

  assert.equal((await retried)?.text, 'en:a')
})

test('the least recently used translation goes first', () => {
  const cache = new TranslationCache(2)

  cache.set(KEY, 'a', translated('a') as never)
  cache.set(KEY, 'b', translated('b') as never)
  cache.get(KEY, 'a')
  cache.set(KEY, 'c', translated('c') as never)
  assert.equal(cache.size, 2)
  assert.ok(cache.get(KEY, 'a'))
  assert.equal(cache.get(KEY, 'b'), undefined)
})

test('configurations do not share translations', () => {
  const cache = new TranslationCache()

  cache.set(KEY, 'a', translated('a') as never)
  assert.equal(cache.get('*|en|auto|lowLatency', 'a'), undefined)
})

test('options keys ignore the order of keys', () => {
  assert.equal(
    optionsKey({ios: {engine: 'apple', strategy: 'highFidelity'}, to: 'en'}),
    // Written in another order on purpose: the same options as JSON that lists them backwards.
    optionsKey(JSON.parse('{"to": "en", "ios": {"strategy": "highFidelity", "engine": "apple"}}'))
  )
  assert.notEqual(optionsKey({to: 'en'}), optionsKey({to: 'de'}))
})
