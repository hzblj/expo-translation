package com.hzblj.expotranslation

@Suppress("UNCHECKED_CAST")
private fun Map<String, Any?>.map(key: String): Map<String, Any?>? = this[key] as? Map<String, Any?>
private fun Map<String, Any?>.string(key: String): String? = this[key] as? String
private fun Map<String, Any?>.bool(key: String): Boolean? = this[key] as? Boolean

/** `TranslatorOptions` from `src/types.ts`, read from the object JavaScript passes. Defaults are the documented ones. */
data class TranslatorOptions(
  val from: String?,
  val to: String,
  val download: Boolean = true,
  val wifiOnly: Boolean = false,
  /** iOS's `ios.engine` and `ios.strategy`: only part of the cache's key here, as on iOS. */
  val iosEngine: String = "auto",
  val iosStrategy: String = "lowLatency"
) {
  /** What the translation of a text depends on besides the text: the JavaScript cache's key. */
  val configurationKey: String get() = listOf(from ?: "*", to, iosEngine, iosStrategy).joinToString("|")

  companion object {
    fun from(map: Map<String, Any?>?): TranslatorOptions {
      val values = map ?: emptyMap()
      val ios = values.map("ios") ?: emptyMap()
      val to = values.string("to")?.takeIf { it.isNotEmpty() }
        ?: throw TranslationFailure(TranslationFailure.UNKNOWN, "Invalid options: `to` is required")

      return TranslatorOptions(
        from = values.string("from")?.takeIf { it.isNotEmpty() },
        to = to,
        download = values.bool("download") ?: true,
        wifiOnly = values.bool("wifiOnly") ?: false,
        iosEngine = ios.string("engine") ?: "auto",
        iosStrategy = ios.string("strategy") ?: "lowLatency"
      )
    }
  }
}

/** The options of `getStatusAsync` and `downloadAsync`. */
data class PairOptions(val from: String, val to: String, val wifiOnly: Boolean = false) {
  companion object {
    fun from(map: Map<String, Any?>?): PairOptions {
      val values = map ?: emptyMap()
      val from = values.string("from")
      val to = values.string("to")

      if (from.isNullOrEmpty() || to.isNullOrEmpty()) {
        throw TranslationFailure(TranslationFailure.UNKNOWN, "Invalid options: `from` and `to` are required")
      }
      return PairOptions(from, to, values.bool("wifiOnly") ?: false)
    }
  }
}
