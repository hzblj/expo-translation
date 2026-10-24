package com.hzblj.expotranslation

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification as MLKitLanguageIdentification
import com.google.mlkit.nl.languageid.LanguageIdentificationOptions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions as MLKitTranslatorOptions
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A Play services task as a suspension, its result delivered on the thread that completes it: no hop to main. */
suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
  addOnCompleteListener({ it.run() }) { task ->
    val exception = task.exception

    when {
      exception != null -> continuation.resumeWithException(exception)
      task.isCanceled -> continuation.cancel()
      else -> continuation.resume(task.result)
    }
  }
}

/** ML Kit's language identification, its model bundled with the app: one client for the process. */
object MLKitIdentifier : Identifier {
  private val client by lazy {
    // A low threshold, so the candidates are more than the winner; the winner is the first either way.
    MLKitLanguageIdentification.getClient(LanguageIdentificationOptions.Builder().setConfidenceThreshold(0.01f).build())
  }

  override suspend fun identify(text: String, maxCandidates: Int): LanguageIdentification {
    if (text.isBlank()) {
      return LanguageIdentification(emptyList())
    }
    val candidates = client.identifyPossibleLanguages(text).await()
      .filter { it.languageTag != "und" }
      .sortedByDescending { it.confidence }
      .take(maxOf(1, maxCandidates))
      .map { IdentifiedLanguage(it.languageTag, it.confidence.toDouble()) }

    return LanguageIdentification(candidates)
  }
}

/**
 * Google's ML Kit: one model per language (English built in), downloaded and deleted by the app, translated on the
 * device. Line by line, because ML Kit drops line breaks.
 */
class MLKitEngine : TranslationEngine {
  override val kind = "mlkit"

  private val models = RemoteModelManager.getInstance()

  /** Loaded translators hold their models in memory (30 to 150 MB each): the few used last are kept. */
  private val translators = object : LinkedHashMap<String, Translator>(4, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Translator>): Boolean =
      (size > KEPT_TRANSLATORS).also { if (it) eldest.value.close() }
  }

  private fun translator(source: String, target: String): Translator = synchronized(translators) {
    translators.getOrPut("$source>$target") {
      Translation.getClient(MLKitTranslatorOptions.Builder().setSourceLanguage(source).setTargetLanguage(target).build())
    }
  }

  private fun pair(request: EngineRequest): Pair<String, String> {
    val source = language(request.from)
    val target = language(request.to)

    if (source == null || target == null || source == target) {
      throw TranslationFailure(
        TranslationFailure.UNSUPPORTED_LANGUAGE,
        "ML Kit does not translate ${request.from} to ${request.to}"
      )
    }
    return source to target
  }

  private suspend fun downloaded(): Set<String> =
    models.getDownloadedModels(TranslateRemoteModel::class.java).await().map { it.language }.toSet() + TranslateLanguage.ENGLISH

  override suspend fun supportedLanguages(): List<String> = TranslateLanguage.getAllLanguages().sorted()

  override suspend fun status(from: String, to: String): LanguageStatus {
    val source = language(from)
    val target = language(to)

    if (source == null || target == null || source == target) {
      return LanguageStatus.UNSUPPORTED
    }
    val downloaded = downloaded()

    return if (source in downloaded && target in downloaded) LanguageStatus.INSTALLED else LanguageStatus.DOWNLOADABLE
  }

  override suspend fun download(request: EngineRequest) {
    val (source, target) = pair(request)
    val conditions = DownloadConditions.Builder().apply { if (request.wifiOnly) requireWifi() }.build()

    try {
      translator(source, target).downloadModelIfNeeded(conditions).await()
    } catch (error: Exception) {
      throw TranslationFailure(TranslationFailure.NETWORK, error.message ?: "The model could not be downloaded", error)
    }
  }

  override suspend fun prepare(request: EngineRequest) {
    val (source, target) = pair(request)
    val downloaded = downloaded()

    if (source !in downloaded || target !in downloaded) {
      if (!request.allowDownload) {
        throw TranslationFailure(
          TranslationFailure.NOT_INSTALLED,
          "${request.from} to ${request.to} is not downloaded on this device"
        )
      }
      download(request)
    }
  }

  override suspend fun translate(texts: List<String>, request: EngineRequest, report: (Int, TranslatedText) -> Unit) {
    prepare(request)
    val (source, target) = pair(request)
    val translator = translator(source, target)

    // ML Kit queues the calls itself: every line of every text goes in at once, and each text is reported when its
    // lines are back.
    coroutineScope {
      texts.mapIndexed { index, text ->
        async {
          val lines = TextLines(text)
          val translated = lines.lines.map { line -> async { translator.translate(line).await() } }.awaitAll()

          report(index, TranslatedText(lines.joined(translated), source, target))
        }
      }.awaitAll()
    }
  }

  override suspend fun downloadedLanguages(): List<String> = (downloaded() - TranslateLanguage.ENGLISH).sorted()

  override suspend fun deleteLanguage(language: String): Boolean {
    val code = language(language) ?: return false

    if (code == TranslateLanguage.ENGLISH || code !in downloaded()) {
      return false
    }
    synchronized(translators) {
      val stale = translators.keys.filter { it.startsWith("$code>") || it.endsWith(">$code") }

      stale.forEach { translators.remove(it)?.close() }
    }
    models.deleteDownloadedModel(TranslateRemoteModel.Builder(code).build()).await()
    return true
  }

  companion object {
    private const val KEPT_TRANSLATORS = 3

    /** ML Kit's language for a tag: its primary language with the codes ML Kit uses. Only Simplified Chinese. */
    fun language(tag: String): String? {
      if (LanguageTags.isTraditionalChinese(tag)) {
        return null
      }
      return TranslateLanguage.fromLanguageTag(LanguageTags.primary(tag))
    }
  }
}
