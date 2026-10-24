import Foundation
import NaturalLanguage

public enum LanguageTags {
  /// The parts of a tag with the likely ones filled in (`zh-TW` is Chinese in Han Traditional): its language and script.
  private static func languageAndScript(_ tag: String) -> (String, String?) {
    let language = Locale.Language(identifier: tag)
    let maximal = Locale.Language(identifier: language.maximalIdentifier)

    return (
      (maximal.languageCode?.identifier ?? tag.split(separator: "-").first.map(String.init) ?? tag).lowercased(),
      maximal.script?.identifier
    )
  }

  /// Whether translating between the two means nothing: the same language in the same script (`en` and `en-GB`, but
  /// not `zh-Hans` and `zh-Hant`). Apple's engine refuses such a pair, and there is nothing to translate anyway.
  public static func sameLanguage(_ a: String, _ b: String) -> Bool {
    let (languageA, scriptA) = languageAndScript(a)
    let (languageB, scriptB) = languageAndScript(b)

    return languageA == languageB && (scriptA == nil || scriptB == nil || scriptA == scriptB)
  }

  /// The language's name in the device's language, starting with a capital: "English (United Kingdom)", "Čeština".
  public static func name(_ tag: String, in locale: Locale = .autoupdatingCurrent) -> String {
    guard let name = locale.localizedString(forIdentifier: tag), !name.isEmpty else {
      return tag
    }
    return name.prefix(1).uppercased(with: locale) + name.dropFirst()
  }
}

public struct IdentifiedLanguage: Sendable, Equatable {
  public let language: String
  public let confidence: Double

  public var json: [String: Any] {
    ["language": language, "confidence": confidence]
  }
}

public struct LanguageIdentification: Sendable {
  public let candidates: [IdentifiedLanguage]

  public var language: String? { candidates.first?.language }

  public var json: [String: Any] {
    [
      "language": language.map { $0 as Any } ?? NSNull(),
      "confidence": candidates.first?.confidence ?? 0,
      "candidates": candidates.map(\.json),
    ]
  }
}

/// Natural Language's identification: on the device, in a fraction of a millisecond for a sentence, simulators
/// included.
public enum LanguageIdentifier {
  public static func identify(_ text: String, maxCandidates: Int = 3) -> LanguageIdentification {
    let recognizer = NLLanguageRecognizer()

    recognizer.processString(text)
    let candidates = recognizer.languageHypotheses(withMaximum: max(1, maxCandidates))
      .filter { $0.key != .undetermined }
      .sorted { $0.value > $1.value }
      .map { IdentifiedLanguage(language: $0.key.rawValue, confidence: $0.value) }

    return LanguageIdentification(candidates: candidates)
  }
}
