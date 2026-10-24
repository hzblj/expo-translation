/** One article of a Wikipedia's front page that day. */
export type Article = {
  id: string
  /** The Wikipedia's language: what the article is written in. */
  wiki: string
  kind: 'featured' | 'most read'
  title: string
  extract: string
  url: string
  thumbnail: {uri: string; width: number; height: number} | null
}

/** Wikipedias in the languages both engines know, and a few only ML Kit does (Czech, Ukrainian on iOS's list too). */
export const WIKIS = ['de', 'fr', 'es', 'it', 'ja', 'pt', 'pl', 'sv', 'zh', 'ko', 'uk', 'nl', 'tr', 'cs', 'ar'] as const

const USER_AGENT = 'expo-translation-example/1.0 (https://github.com/hzblj/expo-translation; hello@janblazej.dev)'

type Summary = {
  titles?: {normalized?: string}
  extract?: string
  content_urls?: {mobile?: {page?: string}}
  thumbnail?: {source: string; width: number; height: number}
}

type Feed = {tfa?: Summary; mostread?: {articles?: Summary[]}}

/** Yesterday in UTC: the most-read list of a day is complete only once it is over. */
const feedDate = () => {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`
}

const article = (wiki: string, kind: Article['kind'], summary: Summary): Article | null => {
  const title = summary.titles?.normalized
  const extract = summary.extract?.trim()

  if (!title || !extract) {
    return null
  }
  return {
    extract,
    id: `${wiki}:${title}`,
    kind,
    thumbnail: summary.thumbnail
      ? {height: summary.thumbnail.height, uri: summary.thumbnail.source, width: summary.thumbnail.width}
      : null,
    title,
    url: summary.content_urls?.mobile?.page ?? `https://${wiki}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    wiki,
  }
}

/**
 * The featured article of a Wikipedia, or, where it has none that day (most do not), its most-read article with a
 * picture and a paragraph to it. Fetched from Wikimedia while the app runs; nothing of theirs is in the repository.
 */
const fetchWiki = async (wiki: string): Promise<Article | null> => {
  // Wikimedia turns away the HTTP clients' own user agents (Android's okhttp gets a 403): it wants one that names the app.
  const response = await fetch(`https://${wiki}.wikipedia.org/api/rest_v1/feed/featured/${feedDate()}`, {
    headers: {'Api-User-Agent': USER_AGENT, 'User-Agent': USER_AGENT},
  })

  if (!response.ok) {
    return null
  }
  const feed = (await response.json()) as Feed

  if (feed.tfa?.extract) {
    return article(wiki, 'featured', feed.tfa)
  }
  const read = feed.mostread?.articles?.find(
    candidate =>
      candidate.thumbnail && (candidate.extract?.length ?? 0) > 120 && !candidate.titles?.normalized?.includes(':')
  )

  return read ? article(wiki, 'most read', read) : null
}

/** One article per Wikipedia, in the order of `WIKIS`; a Wikipedia that fails is left out. */
export const fetchArticles = async (): Promise<Article[]> => {
  const settled = await Promise.allSettled(WIKIS.map(fetchWiki))

  return settled.flatMap(result => (result.status === 'fulfilled' && result.value ? [result.value] : []))
}
