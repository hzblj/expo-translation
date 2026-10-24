import {Translation, type TranslationErrorCode, type TranslatorOptions, useTranslation} from '@hzblj/expo-translation'
import {Box, Button, Image, Island, Pressable, RnText} from '@hzblj/kara-ui'
import {openBrowserAsync} from 'expo-web-browser'
import {useMemo, useState} from 'react'

import {useTarget} from '../target'
import {Pill, TranslationMeta} from '../ui/translation-meta'
import type {Article} from './wikipedia'

const failureText = (code: TranslationErrorCode, wiki: string, target: string) => {
  switch (code) {
    case 'unsupported-language':
      return `No engine on this device translates ${wiki} into ${target}. Apple's framework lacks some languages (Czech among them): MLKIT=1 yarn prebuild bundles ML Kit on iOS for them.`
    case 'unavailable':
      return 'Nothing translates here: Apple translates on a device, not in the simulator. MLKIT=1 yarn prebuild adds ML Kit, which does.'
    default:
      return null
  }
}

/**
 * An article of another Wikipedia, its title and paragraph translated into the target language. Languages are not
 * downloaded by themselves here (fifteen Wikipedias would be fifteen downloads): an article whose languages are
 * missing offers the download, and translates once it is done.
 */
export const ArticleCard = ({article}: {article: Article}) => {
  const {nameOf, target} = useTarget()
  const options = useMemo<TranslatorOptions>(
    () => ({download: false, from: article.wiki, to: target}),
    [article.wiki, target]
  )
  const title = useTranslation(article.title, options)
  const extract = useTranslation(article.extract, options)
  const [original, setOriginal] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const error = extract.error ?? title.error

  const download = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      await Translation.downloadAsync({from: article.wiki, to: target})
      title.retry()
      extract.retry()
    } catch (failure) {
      setDownloadError((failure as Error).message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Box bg="surface.primary" borderRadius="large" overflow="hidden" testID={`article-${article.wiki}`}>
      {article.thumbnail ? (
        <Image
          accessibilityIgnoresInvertColors
          contentFit="cover"
          h={180}
          source={{uri: article.thumbnail.uri}}
          w="100%"
        />
      ) : null}
      <Box gap="s10" p="s16">
        <Box align="center" gap="s6" row>
          <Pill label={nameOf(article.wiki)} tone="accent" />
          <Pill label={article.kind === 'featured' ? 'Featured today' : 'Most read'} />
        </Box>

        <RnText variant="headingS">{original ? article.title : (title.text ?? article.title)}</RnText>

        {original || extract.text ? (
          <RnText color={original ? 'content.secondary' : 'content.primary'} variant="body">
            {original ? article.extract : extract.text}
          </RnText>
        ) : error ? null : (
          <Box gap="s6">
            <Box bg="fill.tertiary" borderRadius="small" h={14} w="100%" />
            <Box bg="fill.tertiary" borderRadius="small" h={14} w="92%" />
            <Box bg="fill.tertiary" borderRadius="small" h={14} w="64%" />
          </Box>
        )}

        {error?.code === 'not-installed' ? (
          <Box gap="s8">
            <RnText color="content.secondary" variant="footnote">
              {`${nameOf(article.wiki)} or ${nameOf(target)} is not downloaded for offline translation yet.`}
            </RnText>
            <Island>
              <Button
                disabled={downloading}
                label={downloading ? 'Downloading…' : `Download ${nameOf(article.wiki)}`}
                onPress={download}
                variant="secondary"
                wide
              />
            </Island>
          </Box>
        ) : error ? (
          <RnText color="content.secondary" variant="footnote">
            {failureText(error.code, nameOf(article.wiki), nameOf(target)) ?? `${error.code}: ${error.message}`}
          </RnText>
        ) : null}
        {downloadError ? (
          <RnText color="content.destructive" variant="footnote">
            {downloadError}
          </RnText>
        ) : null}

        <Box align="center" gap="s8" row>
          <Box fill>
            <TranslationMeta snapshot={extract} />
          </Box>
          {extract.text ? (
            <Pressable accessibilityRole="button" onPress={() => setOriginal(value => !value)} px="s4" py="s4">
              <RnText color="content.accent" variant="footnoteMedium">
                {original ? 'Translation' : 'Original'}
              </RnText>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="link" onPress={() => openBrowserAsync(article.url)} px="s4" py="s4">
            <RnText color="content.accent" variant="footnoteMedium">
              Wikipedia
            </RnText>
          </Pressable>
        </Box>
      </Box>
    </Box>
  )
}
