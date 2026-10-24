package com.hzblj.expotranslation

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope

/** `LanguageStatus` in `src/types.ts`. */
enum class LanguageStatus(val value: String) {
  INSTALLED("installed"),
  DOWNLOADABLE("downloadable"),
  UNSUPPORTED("unsupported")
}

/** One pair of languages for an engine, and what it may do to get them. */
data class EngineRequest(val from: String, val to: String, val allowDownload: Boolean, val wifiOnly: Boolean = false)

/** A text as an engine translated it, with the engine's own tags for the languages. */
data class TranslatedText(val text: String, val sourceLanguage: String, val targetLanguage: String)

/** What translates. On Android that is ML Kit; the interface keeps the core testable and the same as iOS's. */
interface TranslationEngine {
  val kind: String
  suspend fun supportedLanguages(): List<String>
  suspend fun status(from: String, to: String): LanguageStatus
  suspend fun download(request: EngineRequest)
  suspend fun prepare(request: EngineRequest)

  /**
   * Translates texts of one language, reporting each the moment it is done, in any order. A thrown error fails every
   * text not reported yet.
   */
  suspend fun translate(texts: List<String>, request: EngineRequest, report: (Int, TranslatedText) -> Unit)
  suspend fun downloadedLanguages(): List<String>
  suspend fun deleteLanguage(language: String): Boolean
}

/** Identifies a text's language; ML Kit's in the app, a fake in tests. */
fun interface Identifier {
  suspend fun identify(text: String, maxCandidates: Int): LanguageIdentification
}

/** A translation as JavaScript gets it: `TranslationResult` in `src/types.ts`, without `fromCache`. */
data class TranslationOutput(
  val text: String,
  val sourceText: String,
  val sourceLanguage: String,
  val targetLanguage: String,
  /** `null` when the text was already in the target language and nothing translated it. */
  val engine: String?
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "text" to text,
    "sourceText" to sourceText,
    "sourceLanguage" to sourceLanguage,
    "targetLanguage" to targetLanguage,
    "engine" to engine
  )
}

/** One text's outcome: a batch never fails as a whole for one text's sake. */
sealed class TranslationOutcome {
  data class Translated(val output: TranslationOutput) : TranslationOutcome()
  data class Failed(val failure: TranslationFailure) : TranslationOutcome()

  fun toMap(): Map<String, Any?> = when (this) {
    is Translated -> output.toMap()
    is Failed -> mapOf("error" to failure.toMap())
  }
}

/**
 * Picks the engine for a pair: the first that already has both languages, else the first that can download them.
 */
class EngineRouter(val engines: List<TranslationEngine>) {
  suspend fun route(from: String, to: String): Pair<TranslationEngine, LanguageStatus>? {
    var downloadable: TranslationEngine? = null

    for (engine in engines) {
      when (engine.status(from, to)) {
        LanguageStatus.INSTALLED -> return engine to LanguageStatus.INSTALLED
        LanguageStatus.DOWNLOADABLE -> if (downloadable == null) downloadable = engine
        LanguageStatus.UNSUPPORTED -> Unit
      }
    }
    return downloadable?.let { it to LanguageStatus.DOWNLOADABLE }
  }
}

/** Collects a batch's outcomes from concurrent groups, and reports each once. */
private class OutcomeBox(count: Int, private val report: (Int, TranslationOutcome) -> Unit) {
  private val outcomes = arrayOfNulls<TranslationOutcome>(count)

  fun set(index: Int, outcome: TranslationOutcome) {
    val isNew = synchronized(this) {
      if (outcomes[index] != null) {
        false
      } else {
        outcomes[index] = outcome
        true
      }
    }
    if (isNew) {
      report(index, outcome)
    }
  }

  fun isSet(index: Int) = synchronized(this) { outcomes[index] != null }

  val all: List<TranslationOutcome>
    get() = synchronized(this) {
      outcomes.map { it ?: TranslationOutcome.Failed(TranslationFailure(TranslationFailure.UNKNOWN, "The text was not translated")) }
    }
}

/**
 * A translator's logic, without Expo: identifies each text's language when `from` is not given, leaves alone what is
 * already in the target language, groups the rest by language and translates each group as one batch, the groups at
 * the same time. The engine for a language is looked up once and remembered. The same rules as
 * `ios/Core/TranslatorCore.swift`.
 */
class TranslatorCore(
  val options: TranslatorOptions,
  engines: List<TranslationEngine>,
  private val identifier: Identifier
) {
  private val router = EngineRouter(engines)
  private val routes = mutableMapOf<String, TranslationEngine>()

  private fun request(from: String) = EngineRequest(from, options.to, options.download, options.wifiOnly)

  private suspend fun engine(from: String): TranslationEngine {
    synchronized(routes) { routes[from] }?.let { return it }
    if (router.engines.isEmpty()) {
      throw TranslationFailure(TranslationFailure.UNAVAILABLE, "Nothing translates on this device")
    }
    val (engine, status) = router.route(from, options.to)
      ?: throw TranslationFailure(
        TranslationFailure.UNSUPPORTED_LANGUAGE,
        "No engine on this device translates $from to ${options.to}"
      )
    if (status == LanguageStatus.DOWNLOADABLE && !options.download) {
      throw TranslationFailure(TranslationFailure.NOT_INSTALLED, "$from to ${options.to} is not downloaded on this device")
    }
    synchronized(routes) { routes[from] = engine }
    return engine
  }

  /** Loads the engine ahead of the first translation, downloading what is missing when allowed. */
  suspend fun prepare() {
    val from = options.from ?: return

    if (!LanguageTags.sameLanguage(from, options.to)) {
      engine(from).prepare(request(from))
    }
  }

  /** Translates every text, reporting each outcome the moment it is known, and returns them all in order. */
  suspend fun translate(texts: List<String>, report: (Int, TranslationOutcome) -> Unit = { _, _ -> }): List<TranslationOutcome> =
    coroutineScope {
      val box = OutcomeBox(texts.size, report)
      val unchanged = { index: Int, language: String ->
        box.set(
          index,
          TranslationOutcome.Translated(TranslationOutput(texts[index], texts[index], language, options.to, null))
        )
      }
      val languages = texts.mapIndexed { index, text ->
        async {
          when {
            text.isBlank() -> null.also { unchanged(index, options.from ?: options.to) }
            options.from != null -> options.from
            else -> identifier.identify(text, 1).language
          }
        }
      }.awaitAll()
      val groups = linkedMapOf<String, MutableList<Int>>()

      languages.forEachIndexed { index, language ->
        when {
          box.isSet(index) -> Unit
          language == null -> box.set(
            index,
            TranslationOutcome.Failed(
              TranslationFailure(TranslationFailure.UNABLE_TO_IDENTIFY, "The language of the text could not be told")
            )
          )
          LanguageTags.sameLanguage(language, options.to) -> unchanged(index, language)
          else -> groups.getOrPut(language) { mutableListOf() }.add(index)
        }
      }

      groups.map { (language, indices) ->
        async {
          try {
            val engine = engine(language)

            engine.translate(indices.map { texts[it] }, request(language)) { local, translated ->
              val index = indices.getOrNull(local) ?: return@translate

              box.set(
                index,
                TranslationOutcome.Translated(
                  TranslationOutput(translated.text, texts[index], options.from ?: language, options.to, engine.kind)
                )
              )
            }
          } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            val failure = TranslationFailure.from(error)

            for (index in indices) {
              if (!box.isSet(index)) box.set(index, TranslationOutcome.Failed(failure))
            }
          }
        }
      }.awaitAll()

      box.all
    }
}
