import type {TranslationSnapshot} from '@hzblj/expo-translation'
import {Box, RnText} from '@hzblj/kara-ui'
import {useEffect, useRef, useState} from 'react'

const ENGINES = {apple: 'Apple', mlkit: 'ML Kit'} as const

/**
 * How long a translation took, from the moment it was asked for to the moment it arrived: `null` while it runs, and
 * for one that came from the cache.
 */
export const useTranslationTime = (snapshot: TranslationSnapshot): number | null => {
  const started = useRef<number | null>(null)
  const [milliseconds, setMilliseconds] = useState<number | null>(null)

  // A failed attempt (a language still to download, say) doesn't count: the clock starts with the attempt that works.
  if (snapshot.error) {
    started.current = null
  } else if (snapshot.translating && started.current === null) {
    started.current = performance.now()
  }

  useEffect(() => {
    if (!snapshot.result) {
      setMilliseconds(null)
      return
    }
    setMilliseconds(started.current === null || snapshot.result.fromCache ? null : performance.now() - started.current)
    started.current = null
  }, [snapshot.result])

  return milliseconds
}

/** A small pill: what translated a text, how fast, or that it came from the cache. */
export const Pill = ({label, tone = 'neutral'}: {label: string; tone?: 'accent' | 'neutral'}) => (
  <Box bg={tone === 'accent' ? 'fill.accent.base' : 'fill.tertiary'} borderRadius="full" px="s8" py="s2">
    <RnText color={tone === 'accent' ? 'content.accent' : 'content.secondary'} variant="captionMedium">
      {label}
    </RnText>
  </Box>
)

/** The pills under a translation: its engine, its time or the cache. */
export const TranslationMeta = ({snapshot}: {snapshot: TranslationSnapshot}) => {
  const milliseconds = useTranslationTime(snapshot)
  const {result} = snapshot

  if (!result) {
    return null
  }
  return (
    <Box align="center" gap="s6" row wrap>
      <Pill label={result.engine ? ENGINES[result.engine] : 'Already in this language'} tone="accent" />
      {result.fromCache ? <Pill label="From the cache" /> : null}
      {milliseconds !== null ? <Pill label={`${Math.round(milliseconds)} ms`} /> : null}
    </Box>
  )
}
