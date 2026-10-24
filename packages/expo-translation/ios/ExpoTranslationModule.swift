import ExpoModulesCore
import Foundation

/// Options arrive as plain objects and are decoded into the Core's `Decodable` structs, which hold the defaults.
private func decode<T: Decodable>(_ type: T.Type, _ value: [String: Any]?) throws -> T {
  do {
    let data = try JSONSerialization.data(withJSONObject: value ?? [:])
    return try JSONDecoder().decode(T.self, from: data)
  } catch {
    throw TranslationException(TranslationFailure(.unknown, "Invalid options: \(error.localizedDescription)"))
  }
}

/// A failure as a JavaScript error whose `code` is the `TranslationErrorCode`.
final class TranslationException: Exception, @unchecked Sendable {
  private let failure: TranslationFailure

  init(_ failure: TranslationFailure) {
    self.failure = failure
    super.init(name: "TranslationException", description: failure.message, code: failure.code.rawValue)
  }

  override var reason: String {
    failure.message
  }

  override var code: String {
    failure.code.rawValue
  }
}

/// Runs a Core call, turning its failures into JavaScript errors with a `code`.
private func bridging<T>(_ body: () async throws -> T) async throws -> T {
  do {
    return try await body()
  } catch let exception as Exception {
    throw exception
  } catch {
    throw TranslationException(TranslationFailure.from(error))
  }
}

/// The engines this app has, in the order `auto` tries them, made once.
enum Engines {
  static let all: [TranslationEngine] = {
    var engines: [TranslationEngine] = []

    // Apple's framework translates on devices only: in the simulator it calls every pair unsupported (measured on
    // iOS 26.5), which would read as a language problem. Left out there, nothing translates, and availability says why.
    if #available(iOS 18.0, *), !isSimulator {
      engines.append(AppleEngine(sessions: AppSessions()))
    }
    #if EXPO_TRANSLATION_MLKIT
    engines.append(MLKitEngine())
    #endif
    return engines
  }()

  static let router = EngineRouter(engines: all)

  static var isSimulator: Bool {
    #if targetEnvironment(simulator)
    return true
    #else
    return false
    #endif
  }
}

public final class ExpoTranslationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoTranslation")

    AsyncFunction("getAvailabilityAsync") { () -> [String: Any] in
      let engines = Engines.all.map(\.kind.rawValue)
      var sheet = false

      if #available(iOS 17.4, *) {
        sheet = true
      }
      return [
        "available": !engines.isEmpty,
        "engines": engines,
        "reason": engines.isEmpty ? (Engines.isSimulator ? "simulator" : "os") : NSNull(),
        "translationSheet": sheet,
        "manageDownloads": engines.contains(EngineKind.mlkit.rawValue),
      ]
    }

    AsyncFunction("getSupportedLanguagesAsync") { () async -> [[String: Any]] in
      var listed: [(String, EngineKind)] = []

      for engine in Engines.all {
        for language in await engine.supportedLanguages()
        where !listed.contains(where: { LanguageTags.sameLanguage($0.0, language) && $0.1 != engine.kind }) {
          listed.append((language, engine.kind))
        }
      }
      return listed.map { language, engine in
        ["language": language, "name": LanguageTags.name(language), "engine": engine.rawValue]
      }
    }

    AsyncFunction("getStatusAsync") { (options: [String: Any]) async throws -> [String: Any] in
      let pair = try decode(PairOptions.self, options)

      if LanguageTags.sameLanguage(pair.from, pair.to) {
        return ["status": LanguageStatus.installed.rawValue, "engine": NSNull()]
      }
      guard let (engine, status) = await Engines.router.route(from: pair.from, to: pair.to, ios: pair.ios) else {
        return ["status": LanguageStatus.unsupported.rawValue, "engine": NSNull()]
      }
      return ["status": status.rawValue, "engine": engine.kind.rawValue]
    }

    AsyncFunction("downloadAsync") { (options: [String: Any]) async throws in
      let pair = try decode(PairOptions.self, options)

      if LanguageTags.sameLanguage(pair.from, pair.to) {
        return
      }
      try await bridging {
        guard let (engine, _) = await Engines.router.route(from: pair.from, to: pair.to, ios: pair.ios) else {
          throw TranslationFailure(.unsupportedLanguage, "No engine on this device translates \(pair.from) to \(pair.to)")
        }
        try await engine.download(
          EngineRequest(from: pair.from, to: pair.to, allowDownload: true, wifiOnly: pair.wifiOnly, strategy: pair.ios.strategy))
      }
    }

    AsyncFunction("getDownloadedLanguagesAsync") { () async -> [String] in
      var languages: [String] = []

      for engine in Engines.all {
        languages += await engine.downloadedLanguages()
      }
      return languages
    }

    AsyncFunction("deleteDownloadedLanguageAsync") { (language: String) async throws -> Bool in
      try await bridging {
        for engine in Engines.all where try await engine.deleteLanguage(language) {
          return true
        }
        return false
      }
    }

    // A lookup in the system's locale data: synchronous, so a name is there in the same render.
    Function("languageName") { (language: String) -> String in
      LanguageTags.name(language)
    }

    // Natural Language, synchronous inside: a sentence takes a fraction of a millisecond, off the JavaScript thread.
    AsyncFunction("identifyLanguageAsync") { (text: String, maxCandidates: Int) -> [String: Any] in
      LanguageIdentifier.identify(text, maxCandidates: maxCandidates).json
    }

    AsyncFunction("presentTranslationAsync") { (text: String, replace: Bool) async throws -> String? in
      guard #available(iOS 17.4, *) else {
        return nil
      }
      return try await bridging { try await TranslationSheet.present(text: text, replace: replace) }
    }

    Class("Translator", TranslatorObject.self) {
      Constructor { (options: [String: Any]) throws -> TranslatorObject in
        TranslatorObject(options: try decode(TranslatorOptions.self, options))
      }

      Property("from") { (translator: TranslatorObject) -> String? in
        translator.core.options.from
      }

      Property("to") { (translator: TranslatorObject) -> String in
        translator.core.options.to
      }

      Property("configurationKey") { (translator: TranslatorObject) -> String in
        translator.core.options.configurationKey
      }

      AsyncFunction("prepareAsync") { (translator: TranslatorObject) async throws in
        try await bridging { try await translator.core.prepare() }
      }

      AsyncFunction("translateNativeAsync") {
        (translator: TranslatorObject, texts: [String], batch: Int) async -> [[String: Any]] in
        await translator.translate(texts, batch: batch)
      }
    }
  }
}
