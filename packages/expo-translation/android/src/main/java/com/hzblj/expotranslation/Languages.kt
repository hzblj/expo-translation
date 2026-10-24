package com.hzblj.expotranslation

import java.util.Locale

object LanguageTags {
  private val aliases = mapOf("nb" to "no", "nn" to "no", "iw" to "he", "in" to "id", "fil" to "tl", "ji" to "yi")
  private val traditional = setOf("hant", "tw", "hk", "mo")

  private fun parts(tag: String) = tag.replace('_', '-').split('-').filter { it.isNotEmpty() }

  /** The primary language, with the old and macro codes ML Kit uses (`nb` is `no`, `iw` is `he`). */
  fun primary(tag: String): String = parts(tag).firstOrNull()?.lowercase()?.let { aliases[it] ?: it } ?: tag.lowercase()

  /** Whether a Chinese tag means Traditional characters (`zh-Hant`, `zh-TW`, `zh-HK`). */
  fun isTraditionalChinese(tag: String): Boolean =
    primary(tag) == "zh" && parts(tag).drop(1).any { it.lowercase() in traditional }

  /**
   * Whether translating between the two means nothing: the same language (`en` and `en-GB`), except Chinese in two
   * scripts.
   */
  fun sameLanguage(a: String, b: String): Boolean =
    primary(a) == primary(b) && (primary(a) != "zh" || isTraditionalChinese(a) == isTraditionalChinese(b))

  /** The language's name in the device's language, starting with a capital: "English (United Kingdom)", "Čeština". */
  fun name(tag: String, locale: Locale = Locale.getDefault()): String {
    val name = Locale.forLanguageTag(tag).getDisplayName(locale)

    if (name.isNullOrEmpty()) {
      return tag
    }
    return name.substring(0, 1).uppercase(locale) + name.substring(1)
  }
}

data class IdentifiedLanguage(val language: String, val confidence: Double) {
  fun toMap(): Map<String, Any?> = mapOf("language" to language, "confidence" to confidence)
}

data class LanguageIdentification(val candidates: List<IdentifiedLanguage>) {
  val language: String? get() = candidates.firstOrNull()?.language

  fun toMap(): Map<String, Any?> = mapOf(
    "language" to language,
    "confidence" to (candidates.firstOrNull()?.confidence ?: 0.0),
    "candidates" to candidates.map { it.toMap() }
  )
}
