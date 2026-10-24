import {type PairStatus, Translation, type TranslationLanguage} from '@hzblj/expo-translation'
import {Alert, Badge, Box, HStack, Island, Pressable, RnFlatList, RnText, Spacer, Text, VStack} from '@hzblj/kara-ui'
import {useCallback, useEffect, useState} from 'react'

import {useTarget} from '../target'
import {TargetPicker} from '../world/world-screen'

const ENGINES = {apple: 'Apple', mlkit: 'ML Kit'} as const

type Row = TranslationLanguage & {status: PairStatus; downloaded: boolean}

const ORDER = {downloadable: 1, installed: 0, unsupported: 2} as const

const Capabilities = () => {
  const {availability} = useTarget()

  if (!availability) {
    return null
  }
  const rows: [string, string, boolean][] = [
    ['Translates here', availability.available ? 'Yes' : (availability.reason ?? 'No'), availability.available],
    [
      'Engines',
      availability.engines.map(engine => ENGINES[engine]).join(', ') || 'None',
      availability.engines.length > 0,
    ],
    ["Apple's sheet", availability.translationSheet ? 'Yes' : 'No', availability.translationSheet],
    ['Downloads managed by the app', availability.manageDownloads ? 'Yes' : 'No', availability.manageDownloads],
  ]

  return (
    <Island>
      <VStack bg="surface.primary" borderRadius="large" p="s16" spacing="s12" wide>
        {rows.map(([label, value, good]) => (
          <HStack align="center" key={label} wide>
            <Text color="content.secondary">{label}</Text>
            <Spacer />
            <Badge label={value} tone={good ? 'success' : 'neutral'} />
          </HStack>
        ))}
      </VStack>
    </Island>
  )
}

/**
 * Every language some engine translates, and whether it translates into the target language here now: installed
 * first, then what can be downloaded. ML Kit's models can be deleted again; Apple's languages belong to the system.
 */
export const LanguagesScreen = () => {
  const {languages, nameOf, target} = useTarget()
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState<{language: string; action: 'download' | 'delete'} | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(async () => {
    const downloaded = new Set(await Translation.getDownloadedLanguagesAsync())
    const others = languages.filter(language => language.language !== target)
    const statuses = await Promise.all(
      others.map(language => Translation.getStatusAsync({from: language.language, to: target}))
    )

    setRows(
      others
        .map((language, index) => ({
          ...language,
          downloaded: downloaded.has(language.language),
          status: statuses[index] ?? {engine: null, status: 'unsupported' as const},
        }))
        .sort((a, b) => ORDER[a.status.status] - ORDER[b.status.status] || a.name.localeCompare(b.name))
    )
  }, [languages, target])

  useEffect(() => {
    load().catch(error => setFailure((error as Error).message))
  }, [load])

  const run = async (row: Row, action: 'download' | 'delete') => {
    setBusy({action, language: row.language})
    setFailure(null)
    try {
      if (action === 'download') {
        await Translation.downloadAsync({from: row.language, to: target})
      } else {
        await Translation.deleteDownloadedLanguageAsync(row.language)
      }
      await load()
    } catch (error) {
      setFailure((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <RnFlatList
      ListHeaderComponent={
        <Box gap="s16" pb="s8">
          <Capabilities />
          <Box gap="s8">
            <RnText color="content.secondary" variant="footnoteMedium">
              {`INTO ${nameOf(target).toUpperCase()}`}
            </RnText>
            <TargetPicker />
          </Box>
          {failure ? (
            <RnText color="content.destructive" variant="footnote">
              {failure}
            </RnText>
          ) : null}
          <Island>
            <Alert
              confirmLabel="Delete"
              destructive
              message={
                deleting
                  ? `The ${deleting.name} model leaves this device. Translating from or into ${deleting.name} downloads it again.`
                  : undefined
              }
              onConfirm={() => deleting && run(deleting, 'delete')}
              onDismiss={() => setDeleting(null)}
              title={deleting ? `Delete ${deleting.name}?` : ''}
              visible={deleting !== null}
            />
          </Island>
        </Box>
      }
      bg="surface.base"
      content={{gap: 's8', pb: 's96', pt: 's8', px: 's20'}}
      contentInsetAdjustmentBehavior="automatic"
      data={rows}
      flex={1}
      keyExtractor={row => row.language}
      renderItem={({item}) => {
        const working = busy?.language === item.language
        const status =
          working && busy?.action === 'download'
            ? 'Downloading…'
            : item.status.status === 'downloadable'
              ? 'Download'
              : item.status.status === 'installed'
                ? 'Installed'
                : 'Not here'

        return (
          <Pressable
            accessibilityHint={item.status.status === 'downloadable' ? 'Downloads the language' : undefined}
            accessibilityLabel={`${item.name}, ${status}`}
            align="center"
            bg="surface.primary"
            borderRadius="medium"
            disabled={item.status.status !== 'downloadable' || busy !== null}
            gap="s12"
            onPress={() => run(item, 'download')}
            px="s16"
            py="s12"
            row
          >
            <Box fill gap="s2">
              <RnText variant="body">{item.name}</RnText>
              <RnText color="content.tertiary" variant="caption">
                {`${item.language} · ${item.status.engine ? ENGINES[item.status.engine] : ENGINES[item.engine]}`}
              </RnText>
            </Box>
            <RnText
              color={
                item.status.status === 'installed'
                  ? 'content.success'
                  : item.status.status === 'downloadable'
                    ? 'content.accent'
                    : 'content.tertiary'
              }
              variant="footnoteMedium"
            >
              {status}
            </RnText>
            {item.downloaded ? (
              <Pressable
                accessibilityHint="Asks before deleting the downloaded language"
                accessibilityLabel={`Delete ${item.name}`}
                accessibilityRole="button"
                disabled={busy !== null}
                onPress={() => setDeleting(item)}
                pl="s8"
                py="s4"
              >
                <RnText color="content.destructive" variant="footnoteMedium">
                  {working && busy?.action === 'delete' ? 'Deleting…' : 'Delete'}
                </RnText>
              </Pressable>
            ) : null}
          </Pressable>
        )
      }}
      testID="languages"
    />
  )
}
