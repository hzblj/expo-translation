import Translation
import XCTest

@testable import ExpoTranslationCore

/// Apple's engine against the real Translation framework on this Mac. Translating needs the languages downloaded
/// (System Settings, General, Language & Region, Translation Languages): without them those tests skip.
final class AppleEngineTests: XCTestCase {
  private func engine() throws -> AppleEngine {
    AppleEngine(sessions: InstalledSessions())
  }

  func testSupportedLanguagesAreMinimalTags() async throws {
    let languages = try await engine().supportedLanguages()

    XCTAssertTrue(languages.contains("en"))
    XCTAssertTrue(languages.contains("de"))
    XCTAssertTrue(languages.contains("en-GB"))
    XCTAssertFalse(languages.contains("en-US"))
  }

  func testCzechIsNotApples() async throws {
    let engine = try engine()

    let czech = await engine.status(from: "cs", to: "en", strategy: .lowLatency)
    let german = await engine.status(from: "de", to: "en", strategy: .lowLatency)

    XCTAssertEqual(czech, .unsupported)
    XCTAssertNotEqual(german, .unsupported)
  }

  func testAMissingPairWithoutDownloadsIsNotInstalled() async throws {
    let engine = try engine()

    guard await engine.status(from: "de", to: "en", strategy: .lowLatency) == .downloadable else {
      throw XCTSkip("German and English are downloaded on this Mac")
    }
    do {
      try await engine.translate(["Hallo"], EngineRequest(from: "de", to: "en", allowDownload: false)) { _, _ in }
      XCTFail("Translated without the languages")
    } catch {
      XCTAssertEqual(TranslationFailure.from(error).code, .notInstalled)
    }
  }

  func testTranslatesABatchAsItGoes() async throws {
    let engine = try engine()

    guard await engine.status(from: "de", to: "en", strategy: .lowLatency) == .installed else {
      throw XCTSkip("Download German and English in System Settings to translate here")
    }
    let reports = Collected()
    let texts = ["Guten Morgen.", "Der Zug hat Verspätung.", "Ich hätte gern einen Kaffee."]

    try await engine.translate(texts, EngineRequest(from: "de", to: "en", allowDownload: false)) { index, translated in
      reports.add(index, translated.text)
    }
    XCTAssertEqual(reports.indices.sorted(), [0, 1, 2])
    XCTAssertTrue(reports.text(1)?.lowercased().contains("train") ?? false)
  }
}

private final class Collected: @unchecked Sendable {
  private let lock = NSLock()
  private var texts: [Int: String] = [:]

  var indices: [Int] { lock.withLock { Array(texts.keys) } }

  func add(_ index: Int, _ text: String) {
    lock.withLock { texts[index] = text }
  }

  func text(_ index: Int) -> String? {
    lock.withLock { texts[index] }
  }
}
