#if canImport(Translation)
import Foundation
import Translation

/// The pair, strategy and permission a session is asked for.
@available(iOS 18.0, macOS 15.0, *)
public struct AppleSessionRequest: Sendable {
  public let source: Locale.Language
  public let target: Locale.Language
  public let strategy: StrategyChoice
  /// Whether the session may show Apple's download sheet for a missing language.
  public let allowDownload: Bool
  /// The pair's status when the request was made: an installed pair needs no UI on iOS 26.
  public let installed: Bool
}

/// Where sessions come from. Apple hands out sessions that can download languages only to a SwiftUI view in a window
/// (`translationTask`), and before iOS 26 no other kind at all; the module's `HostedSessions` puts such a view in
/// the app. `InstalledSessions` makes them directly, for languages already on the device (iOS 26).
@available(iOS 18.0, macOS 15.0, *)
public protocol AppleSessionProvider: Sendable {
  func withSession<T: Sendable>(
    _ request: AppleSessionRequest, _ body: @escaping @Sendable (TranslationSession) async throws -> T
  ) async throws -> T
}

/// Sessions for languages already on the device, made without any UI and kept per pair (iOS 26 and macOS 26).
@available(iOS 26.0, macOS 26.0, *)
public final class InstalledSessions: AppleSessionProvider, @unchecked Sendable {
  private let lock = NSLock()
  private var sessions: [String: TranslationSession] = [:]

  public init() {}

  private func session(for request: AppleSessionRequest) -> TranslationSession {
    let key = "\(request.source.maximalIdentifier)>\(request.target.maximalIdentifier)|\(request.strategy.rawValue)"

    return lock.withLock {
      if let session = sessions[key] {
        return session
      }
      let session: TranslationSession

      if #available(iOS 26.4, macOS 26.4, *), request.strategy == .highFidelity {
        session = TranslationSession(installedSource: request.source, target: request.target, preferredStrategy: .highFidelity)
      } else {
        session = TranslationSession(installedSource: request.source, target: request.target)
      }
      sessions[key] = session
      return session
    }
  }

  public func withSession<T: Sendable>(
    _ request: AppleSessionRequest, _ body: @escaping @Sendable (TranslationSession) async throws -> T
  ) async throws -> T {
    try await body(session(for: request))
  }

  /// Drops the sessions, which Apple keeps loaded models for.
  public func removeAll() {
    lock.withLock { sessions.removeAll() }
  }
}

/// Apple's Translation framework.
@available(iOS 18.0, macOS 15.0, *)
public final class AppleEngine: TranslationEngine, @unchecked Sendable {
  public let kind = EngineKind.apple
  private let sessions: AppleSessionProvider
  private let lock = NSLock()
  private var supported: [String]?
  /// Pairs seen installed: asked once, not before every batch (a status is a round trip to the translation service).
  private var installedPairs: Set<String> = []

  public init(sessions: AppleSessionProvider) {
    self.sessions = sessions
  }

  private func availability(_ strategy: StrategyChoice) -> LanguageAvailability {
    if #available(iOS 26.4, macOS 26.4, *), strategy == .highFidelity {
      return LanguageAvailability(preferredStrategy: .highFidelity)
    }
    return LanguageAvailability()
  }

  public func supportedLanguages() async -> [String] {
    if let supported = lock.withLock({ supported }) {
      return supported
    }
    let languages = await LanguageAvailability().supportedLanguages.map(\.minimalIdentifier)

    lock.withLock { supported = languages }
    return languages
  }

  private static func pairKey(_ from: String, _ to: String, _ strategy: StrategyChoice) -> String {
    "\(from)>\(to)|\(strategy.rawValue)"
  }

  public func status(from: String, to: String, strategy: StrategyChoice) async -> LanguageStatus {
    let status = await availability(strategy).status(from: Locale.Language(identifier: from), to: Locale.Language(identifier: to))
    let key = Self.pairKey(from, to, strategy)

    switch status {
    case .installed:
      lock.withLock { _ = installedPairs.insert(key) }
      return .installed
    case .supported:
      return .downloadable
    case .unsupported:
      return .unsupported
    @unknown default:
      return .unsupported
    }
  }

  private func sessionRequest(_ request: EngineRequest, allowDownload: Bool) async -> AppleSessionRequest {
    let known = lock.withLock { installedPairs.contains(Self.pairKey(request.from, request.to, request.strategy)) }
    var installed = known

    if !known {
      installed = await status(from: request.from, to: request.to, strategy: request.strategy) == .installed
    }

    return AppleSessionRequest(
      source: Locale.Language(identifier: request.from),
      target: Locale.Language(identifier: request.to),
      strategy: request.strategy,
      allowDownload: allowDownload,
      installed: installed
    )
  }

  /// A pair that turned out not to be installed after all: the user deleted a language in Settings.
  private func forget(_ request: EngineRequest) {
    lock.withLock { _ = installedPairs.remove(Self.pairKey(request.from, request.to, request.strategy)) }
  }

  public func download(_ request: EngineRequest) async throws {
    let sessionRequest = await sessionRequest(request, allowDownload: true)

    if sessionRequest.installed {
      return
    }
    try await sessions.withSession(sessionRequest) { session in
      try await session.prepareTranslation()
    }
  }

  public func prepare(_ request: EngineRequest) async throws {
    let sessionRequest = await sessionRequest(request, allowDownload: request.allowDownload)

    if !sessionRequest.installed {
      guard request.allowDownload else {
        throw TranslationFailure(.notInstalled, "\(request.from) to \(request.to) is not downloaded on this device")
      }
      try await sessions.withSession(sessionRequest) { session in
        try await session.prepareTranslation()
      }
    }
  }

  public func translate(
    _ texts: [String], _ request: EngineRequest, report: @escaping @Sendable (Int, TranslatedText) -> Void
  ) async throws {
    do {
      try await translateOnce(texts, request, report: report)
    } catch let failure where TranslationFailure.from(failure).code == .notInstalled && request.allowDownload {
      // Known installed, deleted since: once more, with a session that can ask for the download.
      forget(request)
      try await translateOnce(texts, request, report: report)
    }
  }

  private func translateOnce(
    _ texts: [String], _ request: EngineRequest, report: @escaping @Sendable (Int, TranslatedText) -> Void
  ) async throws {
    let sessionRequest = await sessionRequest(request, allowDownload: request.allowDownload)

    if !sessionRequest.installed && !request.allowDownload {
      throw TranslationFailure(.notInstalled, "\(request.from) to \(request.to) is not downloaded on this device")
    }
    try await sessions.withSession(sessionRequest) { session in
      if texts.count == 1, let text = texts.first {
        let response = try await session.translate(text)

        report(0, Self.translated(response))
        return
      }
      // The batch comes back as a sequence, each response as soon as it is done.
      let requests = texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }

      for try await response in session.translate(batch: requests) {
        if let identifier = response.clientIdentifier, let index = Int(identifier) {
          report(index, Self.translated(response))
        }
      }
    }
  }

  private static func translated(_ response: TranslationSession.Response) -> TranslatedText {
    TranslatedText(
      text: response.targetText,
      sourceLanguage: response.sourceLanguage.minimalIdentifier,
      targetLanguage: response.targetLanguage.minimalIdentifier
    )
  }

  public func downloadedLanguages() async -> [String] {
    []
  }

  public func deleteLanguage(_ language: String) async throws -> Bool {
    false
  }
}
#endif
