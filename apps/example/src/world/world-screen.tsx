import {Box, Picker, RnFlatList, RnText} from '@hzblj/kara-ui'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {RefreshControl} from 'react-native'

import {useTarget} from '../target'
import {ArticleCard} from './article-card'
import {type Article, fetchArticles} from './wikipedia'

/** The language everything is translated into, from every language some engine knows. */
export const TargetPicker = () => {
  const {languages, setTarget, target} = useTarget()
  const options = useMemo(
    () => languages.map(language => ({label: language.name, value: language.language})),
    [languages]
  )

  if (options.length === 0) {
    return null
  }
  // Picker brings its own host on both platforms: it goes straight into the React Native tree, not into an Island. A
  // menu on iOS, as Android's dropdown is: a wheel would take the screen the translations are for.
  return <Picker onValueChange={setTarget} options={options} pickerStyle="menu" value={target} />
}

/**
 * Today on fifteen Wikipedias: each one's featured or most-read article, translated on the device into the target
 * language as it comes on screen. Rows ask for their translations one by one; the library sends what a screen asks
 * for at once to the engine as one batch per language, and each row lights up as its own text is done.
 */
export const WorldScreen = () => {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailure(null)
    try {
      setArticles(await fetchArticles())
    } catch (error) {
      setFailure((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <RnFlatList
      ListHeaderComponent={
        <Box gap="s8" pb="s8">
          <RnText color="content.secondary" variant="footnoteMedium">
            TRANSLATE INTO
          </RnText>
          <TargetPicker />
          <RnText color="content.tertiary" variant="footnote">
            {failure ?? 'Each Wikipedia’s article of the day, translated on this device. Nothing is sent anywhere.'}
          </RnText>
        </Box>
      }
      bg="surface.base"
      content={{gap: 's16', pb: 's96', pt: 's8', px: 's20'}}
      contentInsetAdjustmentBehavior="automatic"
      data={articles}
      flex={1}
      keyExtractor={article => article.id}
      refreshControl={<RefreshControl onRefresh={load} refreshing={loading} />}
      renderItem={({item}) => <ArticleCard article={item} />}
      testID="world"
    />
  )
}
