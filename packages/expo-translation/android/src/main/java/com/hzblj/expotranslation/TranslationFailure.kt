package com.hzblj.expotranslation

import com.google.mlkit.common.MlKitException
import expo.modules.kotlin.exception.CodedException

/** An error with one of the codes of `TranslationErrorCode` in `src/types.ts`; a JavaScript error with that `code`. */
class TranslationFailure(
  val reason: String,
  message: String,
  cause: Throwable? = null
) : CodedException(reason, message, cause) {

  fun toMap(): Map<String, Any?> = mapOf("code" to reason, "message" to (message ?: reason))

  companion object {
    const val UNSUPPORTED_LANGUAGE = "unsupported-language"
    const val NOT_INSTALLED = "not-installed"
    const val DOWNLOAD_DECLINED = "download-declined"
    const val UNABLE_TO_IDENTIFY = "unable-to-identify"
    const val UNAVAILABLE = "unavailable"
    const val NETWORK = "network"
    const val CANCELLED = "cancelled"
    const val UNKNOWN = "unknown"

    fun from(error: Throwable): TranslationFailure = when (error) {
      is TranslationFailure -> error
      is kotlinx.coroutines.CancellationException -> TranslationFailure(CANCELLED, "The translation was cancelled", error)
      is MlKitException -> when (error.errorCode) {
        MlKitException.NETWORK_ISSUE, MlKitException.UNAVAILABLE, MlKitException.DEADLINE_EXCEEDED ->
          TranslationFailure(NETWORK, error.message ?: "The model could not be downloaded", error)
        MlKitException.NOT_FOUND -> TranslationFailure(NOT_INSTALLED, error.message ?: "The model is not downloaded", error)
        MlKitException.CANCELLED -> TranslationFailure(CANCELLED, error.message ?: "Cancelled", error)
        else -> TranslationFailure(UNKNOWN, error.message ?: error.toString(), error)
      }
      is java.io.IOException -> TranslationFailure(NETWORK, error.message ?: "The model could not be downloaded", error)
      else -> TranslationFailure(UNKNOWN, error.message ?: error.toString(), error)
    }
  }
}
