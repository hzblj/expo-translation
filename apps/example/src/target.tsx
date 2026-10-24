import {Translation, type TranslationAvailability, type TranslationLanguage} from '@hzblj/expo-translation'
import {createContext, type ReactNode, useContext, useEffect, useMemo, useState} from 'react'

/** The device's language as a BCP 47 tag: Hermes has `Intl.DateTimeFormat`, if not `Intl.DisplayNames`. */
export const deviceLanguage = (): string => Intl.DateTimeFormat().resolvedOptions().locale ?? 'en'

const primary = (tag: string) => tag.split('-')[0]?.toLowerCase() ?? tag

type Target = {
  /** The language everything is translated into, picked on any tab. */
  target: string
  setTarget(language: string): void
  /** Every language some engine translates here, by name. */
  languages: TranslationLanguage[]
  availability: TranslationAvailability | null
  /** The language's name: as the engine lists it, or from the platform's locale data. */
  nameOf(language: string): string
}

const TargetContext = createContext<Target | null>(null)

/**
 * The target language, shared by the tabs: the device's language when an engine translates into it, English
 * otherwise.
 */
export const TargetProvider = ({children}: {children: ReactNode}) => {
  const [languages, setLanguages] = useState<TranslationLanguage[]>([])
  const [availability, setAvailability] = useState<TranslationAvailability | null>(null)
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([Translation.getSupportedLanguagesAsync(), Translation.getAvailabilityAsync()]).then(
      ([supported, available]) => {
        const sorted = [...supported].sort((a, b) => a.name.localeCompare(b.name))
        const device = deviceLanguage()
        const match =
          sorted.find(language => language.language === device) ??
          sorted.find(language => language.language === primary(device))

        setLanguages(sorted)
        setAvailability(available)
        setTarget(current => current ?? match?.language ?? 'en')
      }
    )
  }, [])

  const value = useMemo<Target>(() => {
    const names = new Map(languages.map(language => [language.language, language.name]))

    return {
      availability,
      languages,
      nameOf: language => names.get(language) ?? Translation.languageName(language),
      setTarget,
      target: target ?? 'en',
    }
  }, [availability, languages, target])

  return <TargetContext.Provider value={value}>{children}</TargetContext.Provider>
}

export const useTarget = (): Target => {
  const value = useContext(TargetContext)

  if (!value) {
    throw new Error('useTarget needs a TargetProvider')
  }
  return value
}
