import Foundation

/// A translation as JavaScript gets it: `TranslationResult` in `src/types.ts`, without `fromCache`.
public struct TranslationOutput: Sendable, Equatable {
  public let text: String
  public let sourceText: String
  public let sourceLanguage: String
  public let targetLanguage: String
  /// `nil` when the text was already in the target language and nothing translated it.
  public let engine: EngineKind?

  public var json: [String: Any] {
    [
      "text": text,
      "sourceText": sourceText,
      "sourceLanguage": sourceLanguage,
      "targetLanguage": targetLanguage,
      "engine": engine.map { $0.rawValue as Any } ?? NSNull(),
    ]
  }
}

/// One text's outcome: a batch never fails as a whole for one text's sake.
public enum TranslationOutcome: Sendable {
  case translated(TranslationOutput)
  case failed(TranslationFailure)

  public var json: [String: Any] {
    switch self {
    case .translated(let output):
      return output.json
    case .failed(let failure):
      return ["error": failure.json]
    }
  }
}

/// Picks the engine for a pair: the one asked for, or with `auto` the first that already has both languages, else the
/// first that can download them. Engines come in `auto`'s order (Apple first).
public struct EngineRouter: Sendable {
  public let engines: [TranslationEngine]

  public init(engines: [TranslationEngine]) {
    self.engines = engines
  }

  public func candidates(_ choice: EngineChoice) -> [TranslationEngine] {
    switch choice {
    case .auto:
      return engines
    case .apple:
      return engines.filter { $0.kind == .apple }
    case .mlkit:
      return engines.filter { $0.kind == .mlkit }
    }
  }

  public func route(from: String, to: String, ios: IOSOptions) async -> (engine: TranslationEngine, status: LanguageStatus)? {
    var downloadable: TranslationEngine?

    for engine in candidates(ios.engine) {
      switch await engine.status(from: from, to: to, strategy: ios.strategy) {
      case .installed:
        return (engine, .installed)
      case .downloadable:
        downloadable = downloadable ?? engine
      case .unsupported:
        continue
      }
    }
    return downloadable.map { ($0, .downloadable) }
  }
}

/// Collects a batch's outcomes from concurrent groups, and reports each once.
private final class OutcomeBox: @unchecked Sendable {
  private let lock = NSLock()
  private var outcomes: [TranslationOutcome?]
  private let report: @Sendable (Int, TranslationOutcome) -> Void

  init(count: Int, report: @escaping @Sendable (Int, TranslationOutcome) -> Void) {
    outcomes = Array(repeating: nil, count: count)
    self.report = report
  }

  func set(_ index: Int, _ outcome: TranslationOutcome) {
    let isNew = lock.withLock {
      guard outcomes[index] == nil else {
        return false
      }
      outcomes[index] = outcome
      return true
    }
    if isNew {
      report(index, outcome)
    }
  }

  func isSet(_ index: Int) -> Bool {
    lock.withLock { outcomes[index] != nil }
  }

  var all: [TranslationOutcome] {
    lock.withLock {
      outcomes.map { $0 ?? .failed(TranslationFailure(.unknown, "The text was not translated")) }
    }
  }
}

/// A translator's logic, without Expo: identifies each text's language when `from` is not given, leaves alone what is
/// already in the target language, groups the rest by language and translates each group as one batch on its engine,
/// the groups at the same time. The engine for a language is looked up once and remembered.
public final class TranslatorCore: @unchecked Sendable {
  public let options: TranslatorOptions
  private let router: EngineRouter
  private let lock = NSLock()
  private var routes: [String: TranslationEngine] = [:]

  public init(options: TranslatorOptions, engines: [TranslationEngine]) {
    self.options = options
    self.router = EngineRouter(engines: engines)
  }

  private func request(from: String) -> EngineRequest {
    EngineRequest(
      from: from, to: options.to, allowDownload: options.download, wifiOnly: options.wifiOnly, strategy: options.ios.strategy)
  }

  /// The engine for texts in `from`, looked up once.
  private func engine(from: String) async throws -> TranslationEngine {
    if let engine = lock.withLock({ routes[from] }) {
      return engine
    }
    guard !router.candidates(options.ios.engine).isEmpty else {
      throw TranslationFailure(
        .unavailable,
        options.ios.engine == .mlkit
          ? "ML Kit is not in this build: turn on the config plugin's ios.mlkit"
          : "Nothing translates on this device")
    }
    guard let (engine, status) = await router.route(from: from, to: options.to, ios: options.ios) else {
      throw TranslationFailure(.unsupportedLanguage, "No engine on this device translates \(from) to \(options.to)")
    }
    if status == .downloadable && !options.download {
      throw TranslationFailure(.notInstalled, "\(from) to \(options.to) is not downloaded on this device")
    }
    lock.withLock { routes[from] = engine }
    return engine
  }

  /// Loads the engine ahead of the first translation, downloading what is missing when allowed. Without `from`, there
  /// is no pair yet to prepare.
  public func prepare() async throws {
    guard let from = options.from, !LanguageTags.sameLanguage(from, options.to) else {
      return
    }
    try await engine(from: from).prepare(request(from: from))
  }

  /// Translates every text, reporting each outcome the moment it is known, and returns them all in order.
  public func translate(
    _ texts: [String], report: @escaping @Sendable (Int, TranslationOutcome) -> Void = { _, _ in }
  ) async -> [TranslationOutcome] {
    let box = OutcomeBox(count: texts.count, report: report)
    var groups: [String: [Int]] = [:]
    var order: [String] = []

    for (index, text) in texts.enumerated() {
      let unchanged = { (language: String) in
        box.set(
          index,
          .translated(
            TranslationOutput(
              text: text, sourceText: text, sourceLanguage: language, targetLanguage: self.options.to, engine: nil)))
      }

      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        unchanged(options.from ?? options.to)
        continue
      }
      guard let language = options.from ?? LanguageIdentifier.identify(text, maxCandidates: 1).language else {
        box.set(index, .failed(TranslationFailure(.unableToIdentify, "The language of the text could not be told")))
        continue
      }
      if LanguageTags.sameLanguage(language, options.to) {
        unchanged(language)
        continue
      }
      if groups[language] == nil {
        order.append(language)
      }
      groups[language, default: []].append(index)
    }

    await withTaskGroup(of: Void.self) { tasks in
      for language in order {
        let indices = groups[language] ?? []

        tasks.addTask {
          do {
            let engine = try await self.engine(from: language)

            try await engine.translate(indices.map { texts[$0] }, self.request(from: language)) { local, translated in
              guard local < indices.count else {
                return
              }
              let index = indices[local]

              box.set(
                index,
                .translated(
                  TranslationOutput(
                    text: translated.text,
                    sourceText: texts[index],
                    sourceLanguage: self.options.from ?? language,
                    targetLanguage: self.options.to,
                    engine: engine.kind)))
            }
          } catch {
            let failure = TranslationFailure.from(error)

            for index in indices where !box.isSet(index) {
              box.set(index, .failed(failure))
            }
          }
        }
      }
    }
    return box.all
  }
}
