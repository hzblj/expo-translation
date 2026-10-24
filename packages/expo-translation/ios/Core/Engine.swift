import Foundation

public enum EngineKind: String, Sendable {
  case apple, mlkit
}

/// `LanguageStatus` in `src/types.ts`.
public enum LanguageStatus: String, Sendable {
  case installed, downloadable, unsupported
}

/// One pair of languages for an engine, and what it may do to get them.
public struct EngineRequest: Sendable {
  public let from: String
  public let to: String
  /// Whether a missing language may be downloaded (Apple asks the user first).
  public let allowDownload: Bool
  public let wifiOnly: Bool
  public let strategy: StrategyChoice

  public init(from: String, to: String, allowDownload: Bool, wifiOnly: Bool = false, strategy: StrategyChoice = .lowLatency) {
    self.from = from
    self.to = to
    self.allowDownload = allowDownload
    self.wifiOnly = wifiOnly
    self.strategy = strategy
  }
}

/// A text as an engine translated it, with the engine's own tags for the languages.
public struct TranslatedText: Sendable {
  public let text: String
  public let sourceLanguage: String
  public let targetLanguage: String

  public init(text: String, sourceLanguage: String, targetLanguage: String) {
    self.text = text
    self.sourceLanguage = sourceLanguage
    self.targetLanguage = targetLanguage
  }
}

/// What translates: Apple's Translation framework, or ML Kit when the app bundles it.
public protocol TranslationEngine: AnyObject, Sendable {
  var kind: EngineKind { get }
  /// Every language it translates, as its own tags.
  func supportedLanguages() async -> [String]
  func status(from: String, to: String, strategy: StrategyChoice) async -> LanguageStatus
  /// Gets both languages onto the device.
  func download(_ request: EngineRequest) async throws
  /// Loads the engine for the pair (and downloads what is missing, when allowed), ahead of the first translation.
  func prepare(_ request: EngineRequest) async throws
  /// Translates texts of one language, reporting each the moment it is done, in any order. A thrown error fails every
  /// text not reported yet.
  func translate(_ texts: [String], _ request: EngineRequest, report: @escaping @Sendable (Int, TranslatedText) -> Void)
    async throws
  /// Languages the app downloaded and may delete. Apple's belong to the system: none.
  func downloadedLanguages() async -> [String]
  func deleteLanguage(_ language: String) async throws -> Bool
}

/// A text split into lines and the line breaks between them, for an engine that loses line breaks (ML Kit): each line
/// is translated on its own and the breaks are put back as they were, with each line's surrounding spaces.
public struct TextLines: Equatable, Sendable {
  public enum Part: Equatable, Sendable {
    /// Text to translate, with the whitespace around it kept apart.
    case line(leading: String, text: String, trailing: String)
    /// Line breaks, blank lines and whitespace-only lines, kept verbatim.
    case verbatim(String)
  }

  public let parts: [Part]

  public init(_ text: String) {
    var parts: [Part] = []
    var current = ""

    func flushLine() {
      guard !current.isEmpty else {
        return
      }
      let trimmed = current.trimmingCharacters(in: .whitespaces)

      if trimmed.isEmpty {
        parts.append(.verbatim(current))
      } else {
        let leading = String(current.prefix { $0.isWhitespace })
        let trailing = String(String(current.reversed()).prefix { $0.isWhitespace }.reversed())
        parts.append(.line(leading: leading, text: trimmed, trailing: trailing))
      }
      current = ""
    }

    for character in text {
      if character.isNewline {
        flushLine()
        if case .verbatim(let previous)? = parts.last {
          parts[parts.count - 1] = .verbatim(previous + String(character))
        } else {
          parts.append(.verbatim(String(character)))
        }
      } else {
        current.append(character)
      }
    }
    flushLine()
    self.parts = parts
  }

  /// The lines to translate, in order.
  public var lines: [String] {
    parts.compactMap {
      if case .line(_, let text, _) = $0 {
        return text
      }
      return nil
    }
  }

  /// The text again, with the lines replaced by these, in order.
  public func joined(_ translated: [String]) -> String {
    var index = 0

    return parts.map { part -> String in
      switch part {
      case .verbatim(let text):
        return text
      case .line(let leading, let text, let trailing):
        defer { index += 1 }
        return leading + (index < translated.count ? translated[index] : text) + trailing
      }
    }.joined()
  }
}
