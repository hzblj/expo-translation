type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Something was downloaded: a translation that failed with `not-installed` may work now. `useTranslation` listens
 * while it shows that error, so a row waiting for a language translates once any screen downloads it.
 */
export const languagesChanged = () => {
  for (const listener of [...listeners]) {
    listener()
  }
}

export const onLanguagesChanged = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
