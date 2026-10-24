#if EXPO_TRANSLATION_MLKIT
import Foundation
import MLKitCommon
import MLKitTranslate

/// Google's ML Kit on iOS, for the languages Apple's framework lacks. Compiled only when the app turns on the config
/// plugin's `ios.mlkit`. Mirrors the Android engine: one model per language (English built in), downloaded and deleted
/// by the app, line by line translation because ML Kit drops line breaks.
final class MLKitEngine: TranslationEngine, @unchecked Sendable {
  let kind = EngineKind.mlkit
  /// Loaded translators hold their models in memory (30 to 150 MB each): the few used last are kept.
  private static let keptTranslators = 3

  private let lock = NSLock()
  private var translators: [(key: String, translator: MLKitTranslate.Translator)] = []

  /// ML Kit's language for a tag: its primary language, with the aliases ML Kit uses. Only Simplified Chinese.
  static func language(_ tag: String) -> TranslateLanguage? {
    let parts = tag.split(separator: "-").map { String($0) }
    var primary = (parts.first ?? tag).lowercased()

    switch primary {
    case "nb", "nn":
      primary = "no"
    case "iw":
      primary = "he"
    case "in":
      primary = "id"
    case "fil":
      primary = "tl"
    case "zh":
      let rest = parts.dropFirst().map { $0.lowercased() }
      if rest.contains(where: { ["hant", "tw", "hk", "mo"].contains($0) }) {
        return nil
      }
    default:
      break
    }
    let language = TranslateLanguage(rawValue: primary)

    return TranslateLanguage.allLanguages().contains(language) ? language : nil
  }

  private func translator(_ source: TranslateLanguage, _ target: TranslateLanguage) -> MLKitTranslate.Translator {
    let key = "\(source.rawValue)>\(target.rawValue)"

    return lock.withLock {
      if let index = translators.firstIndex(where: { $0.key == key }) {
        let kept = translators.remove(at: index)
        translators.append(kept)
        return kept.translator
      }
      let translator = MLKitTranslate.Translator.translator(
        options: MLKitTranslate.TranslatorOptions(sourceLanguage: source, targetLanguage: target))

      translators.append((key, translator))
      if translators.count > Self.keptTranslators {
        translators.removeFirst()
      }
      return translator
    }
  }

  private func pair(_ request: EngineRequest) throws -> (TranslateLanguage, TranslateLanguage) {
    guard let source = Self.language(request.from), let target = Self.language(request.to) else {
      throw TranslationFailure(.unsupportedLanguage, "ML Kit does not translate \(request.from) to \(request.to)")
    }
    return (source, target)
  }

  private func isDownloaded(_ language: TranslateLanguage) -> Bool {
    language == .english || ModelManager.modelManager().downloadedTranslateModels.contains { $0.language == language }
  }

  func supportedLanguages() async -> [String] {
    TranslateLanguage.allLanguages().map(\.rawValue).sorted()
  }

  func status(from: String, to: String, strategy: StrategyChoice) async -> LanguageStatus {
    guard let source = Self.language(from), let target = Self.language(to), source != target else {
      return .unsupported
    }
    return isDownloaded(source) && isDownloaded(target) ? .installed : .downloadable
  }

  func download(_ request: EngineRequest) async throws {
    let (source, target) = try pair(request)
    let conditions = ModelDownloadConditions(allowsCellularAccess: !request.wifiOnly, allowsBackgroundDownloading: true)
    let translator = translator(source, target)

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      translator.downloadModelIfNeeded(with: conditions) { error in
        if let error {
          continuation.resume(throwing: TranslationFailure(.network, error.localizedDescription))
        } else {
          continuation.resume()
        }
      }
    }
  }

  func prepare(_ request: EngineRequest) async throws {
    let (source, target) = try pair(request)

    if !(isDownloaded(source) && isDownloaded(target)) {
      guard request.allowDownload else {
        throw TranslationFailure(.notInstalled, "\(request.from) to \(request.to) is not downloaded on this device")
      }
      try await download(request)
    }
  }

  private func translate(_ text: String, with translator: MLKitTranslate.Translator) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      translator.translate(text) { result, error in
        if let result {
          continuation.resume(returning: result)
        } else {
          continuation.resume(throwing: TranslationFailure.from(error ?? TranslationFailure(.unknown, "ML Kit returned nothing")))
        }
      }
    }
  }

  func translate(
    _ texts: [String], _ request: EngineRequest, report: @escaping @Sendable (Int, TranslatedText) -> Void
  ) async throws {
    try await prepare(request)
    let (source, target) = try pair(request)
    let translator = translator(source, target)

    // ML Kit queues the calls itself: all lines of all texts go in at once, and each text is reported when its
    // lines are back.
    try await withThrowingTaskGroup(of: Void.self) { group in
      for (index, text) in texts.enumerated() {
        group.addTask {
          let lines = TextLines(text)
          var translated: [String] = []

          for line in lines.lines {
            translated.append(try await self.translate(line, with: translator))
          }
          report(index, TranslatedText(text: lines.joined(translated), sourceLanguage: source.rawValue, targetLanguage: target.rawValue))
        }
      }
      try await group.waitForAll()
    }
  }

  func downloadedLanguages() async -> [String] {
    ModelManager.modelManager().downloadedTranslateModels.map(\.language.rawValue).filter { $0 != TranslateLanguage.english.rawValue }.sorted()
  }

  func deleteLanguage(_ tag: String) async throws -> Bool {
    guard let language = Self.language(tag), language != .english, isDownloaded(language) else {
      return false
    }
    lock.withLock {
      translators.removeAll { $0.key.hasPrefix("\(language.rawValue)>") || $0.key.hasSuffix(">\(language.rawValue)") }
    }
    return try await withCheckedThrowingContinuation { continuation in
      ModelManager.modelManager().deleteDownloadedModel(TranslateRemoteModel.translateRemoteModel(language: language)) { error in
        if let error {
          continuation.resume(throwing: TranslationFailure(.unknown, error.localizedDescription))
        } else {
          continuation.resume(returning: true)
        }
      }
    }
  }
}
#endif
