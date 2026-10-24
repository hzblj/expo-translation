/** What a translator's behaviour depends on, as a stable string: object keys sorted, at any depth. */
export const optionsKey = (options: object): string =>
  JSON.stringify(options, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value
  )
