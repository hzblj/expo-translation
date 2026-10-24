import XCTest

@testable import ExpoTranslationCore

final class TextLinesTests: XCTestCase {
  func testSplitsLinesAndKeepsBreaksAndSpaces() {
    let lines = TextLines("  Hello there.\n\nHow are you? \n")

    XCTAssertEqual(lines.lines, ["Hello there.", "How are you?"])
    XCTAssertEqual(lines.joined(["Ahoj.", "Jak se máš?"]), "  Ahoj.\n\nJak se máš? \n")
  }

  func testWhitespaceOnlyLinesStayVerbatim() {
    let lines = TextLines("One\n   \nTwo")

    XCTAssertEqual(lines.lines, ["One", "Two"])
    XCTAssertEqual(lines.joined(["1", "2"]), "1\n   \n2")
  }

  func testMissingTranslationsKeepTheOriginal() {
    XCTAssertEqual(TextLines("A\nB").joined(["a"]), "a\nB")
  }

  func testCarriageReturnLineFeedIsOneBreak() {
    let lines = TextLines("A\r\nB")

    XCTAssertEqual(lines.lines, ["A", "B"])
    XCTAssertEqual(lines.joined(["a", "b"]), "a\r\nb")
  }
}

final class LanguageTagsTests: XCTestCase {
  func testRegionsAreTheSameLanguage() {
    XCTAssertTrue(LanguageTags.sameLanguage("en", "en-GB"))
    XCTAssertTrue(LanguageTags.sameLanguage("pt-BR", "pt-PT"))
    XCTAssertTrue(LanguageTags.sameLanguage("cs", "cs-CZ"))
  }

  func testScriptsAreNot() {
    XCTAssertFalse(LanguageTags.sameLanguage("zh-Hans", "zh-Hant"))
    XCTAssertFalse(LanguageTags.sameLanguage("zh", "zh-TW"))
    XCTAssertFalse(LanguageTags.sameLanguage("cs", "sk"))
  }

  func testNamesComeFromTheLocale() {
    XCTAssertEqual(LanguageTags.name("cs", in: Locale(identifier: "en")), "Czech")
    XCTAssertEqual(LanguageTags.name("cs", in: Locale(identifier: "cs")), "Čeština")
    XCTAssertEqual(LanguageTags.name("en-GB", in: Locale(identifier: "en")), "English (United Kingdom)")
  }
}

final class LanguageIdentifierTests: XCTestCase {
  func testIdentifiesSentences() {
    XCTAssertEqual(LanguageIdentifier.identify("Dobrý den, jak se dnes máte? Venku hezky svítí slunce.").language, "cs")
    XCTAssertEqual(LanguageIdentifier.identify("Guten Morgen, der Zug hat schon wieder Verspätung.").language, "de")
    XCTAssertEqual(LanguageIdentifier.identify("The quick brown fox jumps over the lazy dog.").language, "en")
  }

  func testCandidatesAreSortedAndCapped() {
    let identification = LanguageIdentifier.identify("Dobrý den, jak se máte?", maxCandidates: 3)

    XCTAssertLessThanOrEqual(identification.candidates.count, 3)
    XCTAssertEqual(identification.candidates.map(\.confidence), identification.candidates.map(\.confidence).sorted(by: >))
  }

  func testNothingToIdentify() {
    XCTAssertNil(LanguageIdentifier.identify("").language)
  }
}

final class OptionsTests: XCTestCase {
  private func decode(_ json: String) throws -> TranslatorOptions {
    try JSONDecoder().decode(TranslatorOptions.self, from: Data(json.utf8))
  }

  func testDefaults() throws {
    let options = try decode(#"{"to": "en"}"#)

    XCTAssertNil(options.from)
    XCTAssertTrue(options.download)
    XCTAssertFalse(options.wifiOnly)
    XCTAssertEqual(options.ios, IOSOptions(engine: .auto, strategy: .lowLatency))
    XCTAssertEqual(options.configurationKey, "*|en|auto|lowLatency")
  }

  func testEverythingSet() throws {
    let options = try decode(
      #"{"from": "cs", "to": "de", "download": false, "ios": {"engine": "mlkit", "strategy": "highFidelity"}}"#)

    XCTAssertEqual(options.from, "cs")
    XCTAssertFalse(options.download)
    XCTAssertEqual(options.configurationKey, "cs|de|mlkit|highFidelity")
  }

  func testAnEmptyFromIsUnset() throws {
    XCTAssertNil(try decode(#"{"from": "", "to": "en"}"#).from)
  }
}

/// An engine with fixed languages that "translates" by tagging the text, and records what it was asked.
private final class FakeEngine: TranslationEngine, @unchecked Sendable {
  let kind: EngineKind
  let installed: Set<String>
  let downloadable: Set<String>
  let failing: Set<String>
  private let lock = NSLock()
  private(set) var batches: [[String]] = []
  private(set) var downloads: [String] = []

  init(_ kind: EngineKind, installed: Set<String> = [], downloadable: Set<String> = [], failing: Set<String> = []) {
    self.kind = kind
    self.installed = installed
    self.downloadable = downloadable
    self.failing = failing
  }

  func supportedLanguages() async -> [String] { Array(installed.union(downloadable)) }

  func status(from: String, to: String, strategy: StrategyChoice) async -> LanguageStatus {
    installed.contains(from) ? .installed : downloadable.contains(from) ? .downloadable : .unsupported
  }

  func download(_ request: EngineRequest) async throws {
    lock.withLock { downloads.append(request.from) }
  }

  func prepare(_ request: EngineRequest) async throws {
    if status(request.from) == .downloadable {
      try await download(request)
    }
  }

  private func status(_ from: String) -> LanguageStatus {
    installed.contains(from) ? .installed : downloadable.contains(from) ? .downloadable : .unsupported
  }

  func translate(_ texts: [String], _ request: EngineRequest, report: @escaping @Sendable (Int, TranslatedText) -> Void)
    async throws
  {
    lock.withLock { batches.append(texts) }
    if failing.contains(request.from) {
      throw TranslationFailure(.unknown, "broken")
    }
    // Backwards, to prove the order of reports does not matter.
    for (index, text) in texts.enumerated().reversed() {
      report(index, TranslatedText(text: "[\(kind.rawValue) \(request.from)>\(request.to)] \(text)", sourceLanguage: request.from, targetLanguage: request.to))
    }
  }

  func downloadedLanguages() async -> [String] { [] }
  func deleteLanguage(_ language: String) async throws -> Bool { false }
}

private final class Reports: @unchecked Sendable {
  private let lock = NSLock()
  private(set) var indices: [Int] = []

  func add(_ index: Int) {
    lock.withLock { indices.append(index) }
  }
}

final class TranslatorCoreTests: XCTestCase {
  private func output(_ outcome: TranslationOutcome) -> TranslationOutput? {
    if case .translated(let output) = outcome {
      return output
    }
    return nil
  }

  private func failure(_ outcome: TranslationOutcome) -> TranslationFailure.Code? {
    if case .failed(let failure) = outcome {
      return failure.code
    }
    return nil
  }

  func testAGivenLanguageIsOneBatchInOrder() async {
    let apple = FakeEngine(.apple, installed: ["de"])
    let core = TranslatorCore(options: TranslatorOptions(from: "de", to: "en"), engines: [apple])
    let reports = Reports()
    let outcomes = await core.translate(["Eins", "Zwei", "Drei"]) { index, _ in reports.add(index) }

    XCTAssertEqual(outcomes.compactMap(output).map(\.text), ["[apple de>en] Eins", "[apple de>en] Zwei", "[apple de>en] Drei"])
    XCTAssertEqual(apple.batches, [["Eins", "Zwei", "Drei"]])
    XCTAssertEqual(reports.indices.sorted(), [0, 1, 2])
    XCTAssertEqual(outcomes.compactMap(output).map(\.engine), [.apple, .apple, .apple])
  }

  func testIdentifiedTextsAreGroupedByLanguage() async {
    let apple = FakeEngine(.apple, installed: ["de", "fr"])
    let core = TranslatorCore(options: TranslatorOptions(to: "en"), engines: [apple])
    let outcomes = await core.translate([
      "Guten Morgen, der Zug hat schon wieder Verspätung.",
      "Bonjour, le train est encore en retard ce matin.",
      "Ich hätte gern einen Kaffee mit Milch, bitte.",
    ])

    XCTAssertEqual(outcomes.compactMap(output).map(\.sourceLanguage), ["de", "fr", "de"])
    XCTAssertEqual(Set(apple.batches.map(\.count)), [1, 2])
  }

  func testTextAlreadyInTheTargetComesBackUntouched() async {
    let apple = FakeEngine(.apple, installed: ["de"])
    let core = TranslatorCore(options: TranslatorOptions(to: "en"), engines: [apple])
    let outcomes = await core.translate(["The quick brown fox jumps over the lazy dog.", "  "])

    XCTAssertEqual(outcomes.compactMap(output).map(\.text), ["The quick brown fox jumps over the lazy dog.", "  "])
    XCTAssertEqual(outcomes.compactMap(output).map(\.engine), [nil, nil])
    XCTAssertTrue(apple.batches.isEmpty)
  }

  func testAutoPrefersAnEngineThatHasTheLanguagesAlready() async {
    let apple = FakeEngine(.apple, downloadable: ["de"])
    let mlkit = FakeEngine(.mlkit, installed: ["de", "cs"])
    let core = TranslatorCore(options: TranslatorOptions(from: "de", to: "en"), engines: [apple, mlkit])

    let outcomes = await core.translate(["Hallo Welt"])

    XCTAssertEqual(output(outcomes[0])?.engine, .mlkit)
  }

  func testAutoFallsBackToMLKitForWhatAppleLacks() async {
    let apple = FakeEngine(.apple, installed: ["de"])
    let mlkit = FakeEngine(.mlkit, downloadable: ["cs"])
    let core = TranslatorCore(options: TranslatorOptions(from: "cs", to: "en"), engines: [apple, mlkit])

    let outcomes = await core.translate(["Ahoj světe"])

    XCTAssertEqual(output(outcomes[0])?.engine, .mlkit)
  }

  func testAnEngineCanBeForced() async {
    let apple = FakeEngine(.apple, installed: ["cs"])
    let core = TranslatorCore(
      options: TranslatorOptions(from: "cs", to: "en", ios: IOSOptions(engine: .mlkit)), engines: [apple])

    let outcomes = await core.translate(["Ahoj"])

    XCTAssertEqual(failure(outcomes[0]), .unavailable)
  }

  func testUnsupportedAndNotInstalled() async {
    let apple = FakeEngine(.apple, downloadable: ["de"])
    let unsupported = TranslatorCore(options: TranslatorOptions(from: "cs", to: "en"), engines: [apple])
    let noDownload = TranslatorCore(options: TranslatorOptions(from: "de", to: "en", download: false), engines: [apple])

    let unsupportedOutcomes = await unsupported.translate(["Ahoj"])
    let noDownloadOutcomes = await noDownload.translate(["Hallo"])

    XCTAssertEqual(failure(unsupportedOutcomes[0]), .unsupportedLanguage)
    XCTAssertEqual(failure(noDownloadOutcomes[0]), .notInstalled)
    XCTAssertTrue(apple.batches.isEmpty)
  }

  func testOneFailingLanguageFailsOnlyItsTexts() async {
    let apple = FakeEngine(.apple, installed: ["de", "fr"], failing: ["fr"])
    let core = TranslatorCore(options: TranslatorOptions(to: "en"), engines: [apple])
    let outcomes = await core.translate([
      "Guten Morgen, der Zug hat schon wieder Verspätung.",
      "Bonjour, le train est encore en retard ce matin.",
    ])

    XCTAssertNotNil(output(outcomes[0]))
    XCTAssertEqual(failure(outcomes[1]), .unknown)
  }

  func testPrepareDownloadsTheGivenPair() async throws {
    let apple = FakeEngine(.apple, downloadable: ["de"])

    try await TranslatorCore(options: TranslatorOptions(from: "de", to: "en"), engines: [apple]).prepare()
    try await TranslatorCore(options: TranslatorOptions(to: "en"), engines: [apple]).prepare()
    XCTAssertEqual(apple.downloads, ["de"])
  }
}
