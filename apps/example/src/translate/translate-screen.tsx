import {
  type LanguageIdentification,
  Translation,
  type TranslationResult,
  type TranslatorOptions,
  useTranslation,
  useTranslator,
} from '@hzblj/expo-translation'
import {Box, Button, IconButton, Island, Picker, Pressable, RnText, TextField} from '@hzblj/kara-ui'
import {setStringAsync} from 'expo-clipboard'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Platform} from 'react-native'

import {useTarget} from '../target'
import {Page, Section} from '../ui/page'
import {Pill, TranslationMeta} from '../ui/translation-meta'
import {TargetPicker} from '../world/world-screen'
import {BATCH_SENTENCES, SAMPLE_TEXT} from './samples'

const DETECT = 'detect'

/** The value a while after it stops changing: the playground translates what was typed, not every keystroke. */
const useSettled = <T,>(value: T, delay = 250): T => {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)

    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}

type BatchRun = {first: number | null; all: number | null; results: (TranslationResult | null)[]; error: string | null}

/**
 * Two dozen sentences through one translator as one batch: how long the first one takes to arrive, and all of them.
 * Each lights up as the engine finishes it (`onResult`). A second run comes from the cache.
 */
const Batch = () => {
  const {target} = useTarget()
  const translator = useTranslator({from: 'de', to: target})
  const [run, setRun] = useState<BatchRun | null>(null)
  const frame = useRef<number | null>(null)

  const start = () => {
    const started = performance.now()
    const current: BatchRun = {all: null, error: null, first: null, results: BATCH_SENTENCES.map(() => null)}
    let arrived = 0
    // The results land in `current` as they come and the screen follows once a frame: the times are the library's,
    // not this screen's renders.
    const show = () => {
      frame.current = null
      setRun({...current, results: [...current.results]})
    }
    const showSoon = () => {
      frame.current ??= requestAnimationFrame(show)
    }

    translator
      .translateBatchAsync(BATCH_SENTENCES, {
        onResult: (result, index) => {
          const now = performance.now() - started

          current.first ??= now
          current.results[index] = result
          arrived += 1
          if (arrived === BATCH_SENTENCES.length) {
            current.all = now
          }
          showSoon()
        },
      })
      .catch((error: Error) => {
        current.error = error.message
        showSoon()
      })
    show()
  }

  const done = run?.results.filter(Boolean).length ?? 0

  return (
    <Section
      caption="One call, one batch: Apple's engine returns the sentences as a sequence and ML Kit one by one, and each shows up the moment it is done. Run it again and it comes from the cache."
      title="Batch"
    >
      <Island>
        <Button
          label={run && run.all === null && !run.error ? 'Translating…' : 'Translate 24 sentences'}
          onPress={start}
          wide
        />
      </Island>
      {run ? (
        <Box bg="surface.primary" borderRadius="large" gap="s10" p="s16">
          <Box align="center" gap="s6" row wrap>
            <Pill label={`${done} of ${BATCH_SENTENCES.length}`} tone="accent" />
            {run.first !== null ? <Pill label={`First in ${Math.round(run.first)} ms`} /> : null}
            {run.all !== null ? <Pill label={`All in ${Math.round(run.all)} ms`} /> : null}
            {run.results[0]?.fromCache ? <Pill label="From the cache" /> : null}
            <Box fill />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                Translation.clearCache()
                setRun(null)
              }}
              px="s4"
              py="s4"
            >
              <RnText color="content.accent" variant="footnoteMedium">
                Clear cache
              </RnText>
            </Pressable>
          </Box>
          {run.error ? (
            <RnText color="content.destructive" variant="footnote">
              {run.error}
            </RnText>
          ) : null}
          {BATCH_SENTENCES.map((sentence, index) => (
            <RnText
              color={run.results[index] ? 'content.primary' : 'content.tertiary'}
              key={sentence}
              variant="subheadline"
            >
              {run.results[index]?.text ?? sentence}
            </RnText>
          ))}
        </Box>
      ) : null}
    </Section>
  )
}

/**
 * Type in any language: its language is identified as you go, and the text translated into the target language.
 * On iOS, Apple's own translation sheet can take over, and hand its translation back.
 */
export const TranslateScreen = () => {
  const {availability, languages, nameOf, setTarget, target} = useTarget()
  const [input, setInput] = useState(SAMPLE_TEXT)
  const [inputKey, setInputKey] = useState(0)
  const [from, setFrom] = useState(DETECT)
  const [identified, setIdentified] = useState<LanguageIdentification | null>(null)
  const text = useSettled(input).trim()
  const options = useMemo<TranslatorOptions>(
    () => ({from: from === DETECT ? undefined : from, to: target}),
    [from, target]
  )
  const translation = useTranslation(text || null, options)

  useEffect(() => {
    if (!text) {
      setIdentified(null)
      return
    }
    let current = true

    Translation.identifyLanguageAsync(text).then(result => current && setIdentified(result))
    return () => {
      current = false
    }
  }, [text])

  const sources = useMemo(
    () => [
      {label: 'Detect language', value: DETECT},
      ...languages.map(language => ({label: language.name, value: language.language})),
    ],
    [languages]
  )

  const replaceInput = (value: string) => {
    setInput(value)
    setInputKey(key => key + 1)
  }

  const swap = () => {
    const source = from === DETECT ? (translation.result?.sourceLanguage ?? identified?.language) : from

    if (source && translation.text) {
      setFrom(target)
      setTarget(source)
      replaceInput(translation.text)
    }
  }

  return (
    <Page>
      <Section
        caption={
          identified?.language
            ? `Looks like ${nameOf(identified.language)} (${Math.round(identified.confidence * 100)} %)${
                identified.candidates[1] ? `, or ${nameOf(identified.candidates[1].language)}` : ''
              }.`
            : 'Type a sentence or two in any language.'
        }
        title="Text"
      >
        <Island>
          <TextField defaultValue={input} key={inputKey} multiline onChangeText={setInput} testID="input" />
        </Island>
        <Picker onValueChange={setFrom} options={sources} value={from} />
      </Section>

      <Section title="Into">
        <Box align="center" gap="s8" row>
          <Box fill>
            <TargetPicker />
          </Box>
          <Island h={56} w={56}>
            <IconButton accessibilityLabel="Swap the languages" name="swap-horiz" onPress={swap} />
          </Island>
        </Box>
      </Section>

      <Section
        caption={
          translation.error
            ? `${translation.error.code}: ${translation.error.message}`
            : 'A missing language downloads the first time: Apple asks in its own sheet, ML Kit just fetches it.'
        }
        title="Translation"
      >
        <Box bg="surface.primary" borderRadius="large" gap="s12" minH={96} p="s16" testID="translation">
          <RnText color={translation.text ? 'content.primary' : 'content.tertiary'} variant="body">
            {translation.text ?? (translation.translating ? 'Translating…' : ' ')}
          </RnText>
          <Box align="center" gap="s8" row>
            <Box fill>
              <TranslationMeta snapshot={translation} />
            </Box>
            {translation.text ? (
              <Island>
                <IconButton
                  accessibilityLabel="Copy the translation"
                  name="content-copy"
                  onPress={() => translation.text && setStringAsync(translation.text)}
                />
              </Island>
            ) : null}
          </Box>
        </Box>
      </Section>

      {Platform.OS === 'ios' && availability?.translationSheet ? (
        <Section
          caption="Apple's own translation sheet, with its language pickers. Replace with Translation hands the text back here."
          title="Apple's sheet"
        >
          <Island>
            <Button
              label="Translate in Apple's sheet"
              onPress={async () => {
                const replaced = await Translation.presentTranslationAsync(input, {replace: true})

                if (replaced) {
                  replaceInput(replaced)
                }
              }}
              variant="secondary"
              wide
            />
          </Island>
        </Section>
      ) : null}

      <Batch />
    </Page>
  )
}
