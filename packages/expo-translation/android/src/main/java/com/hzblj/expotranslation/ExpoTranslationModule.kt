package com.hzblj.expotranslation

import expo.modules.kotlin.AppContext
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedObject
import kotlinx.coroutines.launch

/** The engines this app has: ML Kit, one for the process, so its loaded models are shared by every translator. */
private val engines: List<TranslationEngine> by lazy { listOf(MLKitEngine()) }
private val router by lazy { EngineRouter(engines) }

/**
 * A translator shared with JavaScript as `Translator`. The engine keeps its models loaded while translators use them.
 */
class TranslatorObject(appContext: AppContext, options: TranslatorOptions) : SharedObject(appContext) {
  val core = TranslatorCore(options, engines, MLKitIdentifier)

  private fun send(payload: Map<String, Any?>) {
    appContext?.mainQueue?.launch { emit("translated", payload) }
  }

  /**
   * Every text's outcome, in order; with more than one text, each is also sent as a `translated` event the moment it
   * is done, so JavaScript settles it without waiting for the rest.
   */
  suspend fun translate(texts: List<String>, batch: Int): List<Map<String, Any?>> {
    val streams = texts.size > 1

    return core.translate(texts) { index, outcome ->
      if (streams) {
        send(mapOf("batch" to batch, "index" to index, "outcome" to outcome.toMap()))
      }
    }.map { it.toMap() }
  }
}

class ExpoTranslationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoTranslation")

    AsyncFunction("getAvailabilityAsync") {
      mapOf(
        "available" to true,
        "engines" to engines.map { it.kind },
        "reason" to null,
        "translationSheet" to false,
        "manageDownloads" to true
      )
    }

    AsyncFunction("getSupportedLanguagesAsync") Coroutine { ->
      engines.flatMap { engine ->
        engine.supportedLanguages().map { mapOf("language" to it, "name" to LanguageTags.name(it), "engine" to engine.kind) }
      }
    }

    AsyncFunction("getStatusAsync") Coroutine { options: Map<String, Any?> ->
      val pair = PairOptions.from(options)

      if (LanguageTags.sameLanguage(pair.from, pair.to)) {
        mapOf("status" to LanguageStatus.INSTALLED.value, "engine" to null)
      } else {
        val route = router.route(pair.from, pair.to)

        mapOf(
          "status" to (route?.second ?: LanguageStatus.UNSUPPORTED).value,
          "engine" to route?.first?.kind
        )
      }
    }

    AsyncFunction("downloadAsync") Coroutine { options: Map<String, Any?> ->
      val pair = PairOptions.from(options)

      if (!LanguageTags.sameLanguage(pair.from, pair.to)) {
        val (engine, _) = router.route(pair.from, pair.to)
          ?: throw TranslationFailure(
            TranslationFailure.UNSUPPORTED_LANGUAGE,
            "No engine on this device translates ${pair.from} to ${pair.to}"
          )
        engine.download(EngineRequest(pair.from, pair.to, allowDownload = true, wifiOnly = pair.wifiOnly))
      }
    }

    AsyncFunction("getDownloadedLanguagesAsync") Coroutine { ->
      engines.flatMap { it.downloadedLanguages() }
    }

    AsyncFunction("deleteDownloadedLanguageAsync") Coroutine { language: String ->
      try {
        engines.any { it.deleteLanguage(language) }
      } catch (error: Throwable) {
        throw TranslationFailure.from(error)
      }
    }

    // A lookup in the platform's locale data: synchronous, so a name is there in the same render.
    Function("languageName") { language: String -> LanguageTags.name(language) }

    AsyncFunction("identifyLanguageAsync") Coroutine { text: String, maxCandidates: Int ->
      MLKitIdentifier.identify(text, maxCandidates).toMap()
    }

    // Apple's sheet has no Android counterpart.
    AsyncFunction("presentTranslationAsync") { _: String, _: Boolean -> null }

    Class("Translator", TranslatorObject::class) {
      Constructor { options: Map<String, Any?> ->
        TranslatorObject(appContext, TranslatorOptions.from(options))
      }

      Property("from") { translator: TranslatorObject -> translator.core.options.from }

      Property("to") { translator: TranslatorObject -> translator.core.options.to }

      Property("configurationKey") { translator: TranslatorObject -> translator.core.options.configurationKey }

      AsyncFunction("prepareAsync") Coroutine { translator: TranslatorObject ->
        try {
          translator.core.prepare()
        } catch (error: Throwable) {
          throw TranslationFailure.from(error)
        }
      }

      AsyncFunction("translateNativeAsync") Coroutine { translator: TranslatorObject, texts: List<String>, batch: Int ->
        translator.translate(texts, batch)
      }
    }
  }
}
