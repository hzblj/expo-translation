import Foundation
#if canImport(Translation)
import Translation
#endif

/// An error with one of the codes of `TranslationErrorCode` in `src/types.ts`.
public struct TranslationFailure: Error, LocalizedError, Sendable {
  public enum Code: String, Sendable {
    case unsupportedLanguage = "unsupported-language"
    case notInstalled = "not-installed"
    case downloadDeclined = "download-declined"
    case unableToIdentify = "unable-to-identify"
    case unavailable
    case network
    case cancelled
    case unknown
  }

  public let code: Code
  public let message: String

  public init(_ code: Code, _ message: String) {
    self.code = code
    self.message = message
  }

  public var errorDescription: String? {
    message
  }

  public var json: [String: Any] {
    ["code": code.rawValue, "message": message]
  }

  /// Any error, as a failure with the closest code.
  public static func from(_ error: Error) -> TranslationFailure {
    if let failure = error as? TranslationFailure {
      return failure
    }
    if error is CancellationError {
      return TranslationFailure(.cancelled, "The translation was cancelled")
    }
    if let cocoa = error as? CocoaError, cocoa.code == .userCancelled {
      return TranslationFailure(.downloadDeclined, "The languages were not downloaded: the user declined or closed the sheet")
    }
    #if canImport(Translation)
    if #available(iOS 18.0, macOS 15.0, *), let failure = fromTranslation(error) {
      return failure
    }
    #endif

    let nsError = error as NSError

    if nsError.domain == NSURLErrorDomain {
      return TranslationFailure(.network, nsError.localizedDescription)
    }
    return TranslationFailure(.unknown, nsError.localizedDescription)
  }

  #if canImport(Translation)
  @available(iOS 18.0, macOS 15.0, *)
  private static func fromTranslation(_ error: Error) -> TranslationFailure? {
    guard error is TranslationError else {
      return nil
    }
    let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription

    // `notInstalled` and `alreadyCancelled` came with iOS 26: sessions made without a view throw the first.
    if #available(iOS 26.0, macOS 26.0, *) {
      switch error {
      case TranslationError.notInstalled:
        return TranslationFailure(.notInstalled, message)
      case TranslationError.alreadyCancelled:
        return TranslationFailure(.cancelled, message)
      default:
        break
      }
    }
    switch error {
    case TranslationError.unsupportedSourceLanguage, TranslationError.unsupportedTargetLanguage,
      TranslationError.unsupportedLanguagePairing:
      return TranslationFailure(.unsupportedLanguage, message)
    case TranslationError.unableToIdentifyLanguage:
      return TranslationFailure(.unableToIdentify, message)
    default:
      return TranslationFailure(.unknown, message)
    }
  }
  #endif
}
