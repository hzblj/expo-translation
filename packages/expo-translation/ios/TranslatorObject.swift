import ExpoModulesCore

/// A translator shared with JavaScript as `Translator`. Its engines keep their sessions and models loaded for as long
/// as JavaScript holds it.
final class TranslatorObject: SharedObject, @unchecked Sendable {
  let core: TranslatorCore

  init(options: TranslatorOptions) {
    core = TranslatorCore(options: options, engines: Engines.all)
    super.init()
  }

  /// Every text's outcome, in order; with more than one text, each is also sent as a `translated` event the moment it
  /// is done, so JavaScript settles it without waiting for the rest.
  func translate(_ texts: [String], batch: Int) async -> [[String: Any]] {
    let streams = texts.count > 1
    let outcomes = await core.translate(texts) { [weak self] index, outcome in
      if streams {
        self?.emit(event: "translated", payload: ["batch": batch, "index": index, "outcome": outcome.json])
      }
    }

    return outcomes.map(\.json)
  }
}
