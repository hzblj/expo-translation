package com.hzblj.expotranslation

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TextLinesTest {
  @Test
  fun splitsLinesAndKeepsBreaksAndSpaces() {
    val lines = TextLines("  Hello there.\n\nHow are you? \n")

    assertEquals(listOf("Hello there.", "How are you?"), lines.lines)
    assertEquals("  Ahoj.\n\nJak se máš? \n", lines.joined(listOf("Ahoj.", "Jak se máš?")))
  }

  @Test
  fun whitespaceOnlyLinesStayVerbatim() {
    val lines = TextLines("One\n   \nTwo")

    assertEquals(listOf("One", "Two"), lines.lines)
    assertEquals("1\n   \n2", lines.joined(listOf("1", "2")))
  }

  @Test
  fun missingTranslationsKeepTheOriginal() {
    assertEquals("a\nB", TextLines("A\nB").joined(listOf("a")))
  }

  @Test
  fun carriageReturnLineFeedIsOneBreak() {
    val lines = TextLines("A\r\nB")

    assertEquals(listOf("A", "B"), lines.lines)
    assertEquals("a\r\nb", lines.joined(listOf("a", "b")))
  }
}

class LanguageTagsTest {
  @Test
  fun regionsAreTheSameLanguage() {
    assertTrue(LanguageTags.sameLanguage("en", "en-GB"))
    assertTrue(LanguageTags.sameLanguage("pt-BR", "pt-PT"))
    assertTrue(LanguageTags.sameLanguage("nb", "no"))
  }

  @Test
  fun chineseScriptsAreNot() {
    assertFalse(LanguageTags.sameLanguage("zh-Hans", "zh-Hant"))
    assertFalse(LanguageTags.sameLanguage("zh", "zh-TW"))
    assertFalse(LanguageTags.sameLanguage("cs", "sk"))
    assertTrue(LanguageTags.isTraditionalChinese("zh-Hant-TW"))
    assertFalse(LanguageTags.isTraditionalChinese("zh-CN"))
  }

  @Test
  fun primaryUsesMLKitsCodes() {
    assertEquals("he", LanguageTags.primary("iw"))
    assertEquals("no", LanguageTags.primary("nb-NO"))
    assertEquals("cs", LanguageTags.primary("cs_CZ"))
  }
}

class OptionsTest {
  @Test
  fun defaults() {
    val options = TranslatorOptions.from(mapOf("to" to "en"))

    assertNull(options.from)
    assertTrue(options.download)
    assertFalse(options.wifiOnly)
    assertEquals("*|en|auto|lowLatency", options.configurationKey)
  }

  @Test
  fun everythingSet() {
    val options = TranslatorOptions.from(
      mapOf(
        "from" to "cs",
        "to" to "de",
        "download" to false,
        "wifiOnly" to true,
        "ios" to mapOf("engine" to "mlkit", "strategy" to "highFidelity")
      )
    )

    assertEquals("cs", options.from)
    assertFalse(options.download)
    assertTrue(options.wifiOnly)
    assertEquals("cs|de|mlkit|highFidelity", options.configurationKey)
  }

  @Test
  fun anEmptyFromIsUnset() {
    assertNull(TranslatorOptions.from(mapOf("from" to "", "to" to "en")).from)
  }
}

/** An engine with fixed languages that "translates" by tagging the text, and records what it was asked. */
private class FakeEngine(
  override val kind: String,
  val installed: Set<String> = emptySet(),
  val downloadable: Set<String> = emptySet(),
  val failing: Set<String> = emptySet()
) : TranslationEngine {
  val batches = mutableListOf<List<String>>()
  val downloads = mutableListOf<String>()

  private fun statusOf(from: String) = when (from) {
    in installed -> LanguageStatus.INSTALLED
    in downloadable -> LanguageStatus.DOWNLOADABLE
    else -> LanguageStatus.UNSUPPORTED
  }

  override suspend fun supportedLanguages() = (installed + downloadable).toList()
  override suspend fun status(from: String, to: String) = statusOf(from)
  override suspend fun download(request: EngineRequest) {
    synchronized(downloads) { downloads.add(request.from) }
  }

  override suspend fun prepare(request: EngineRequest) {
    if (statusOf(request.from) == LanguageStatus.DOWNLOADABLE) download(request)
  }

  override suspend fun translate(texts: List<String>, request: EngineRequest, report: (Int, TranslatedText) -> Unit) {
    synchronized(batches) { batches.add(texts) }
    if (request.from in failing) throw TranslationFailure(TranslationFailure.UNKNOWN, "broken")
    // Backwards, to prove the order of reports does not matter.
    texts.indices.reversed().forEach { index ->
      report(index, TranslatedText("[$kind ${request.from}>${request.to}] ${texts[index]}", request.from, request.to))
    }
  }

  override suspend fun downloadedLanguages() = emptyList<String>()
  override suspend fun deleteLanguage(language: String) = false
}

/** Identifies by a word in the text, the way a real identifier would by its letters. */
private val identifier = Identifier { text, _ ->
  val language = when {
    text.contains("Zug") || text.contains("Kaffee") -> "de"
    text.startsWith("Le ") -> "fr"
    text.contains("quick") -> "en"
    else -> null
  }
  LanguageIdentification(listOfNotNull(language?.let { IdentifiedLanguage(it, 0.9) }))
}

class TranslatorCoreTest {
  private fun options(from: String? = null, to: String = "en", download: Boolean = true) =
    TranslatorOptions(from = from, to = to, download = download)

  private fun output(outcome: TranslationOutcome) = (outcome as? TranslationOutcome.Translated)?.output
  private fun failure(outcome: TranslationOutcome) = (outcome as? TranslationOutcome.Failed)?.failure?.reason

  @Test
  fun aGivenLanguageIsOneBatchInOrder() = runBlocking {
    val engine = FakeEngine("mlkit", installed = setOf("de"))
    val reported = mutableListOf<Int>()
    val outcomes = TranslatorCore(options(from = "de"), listOf(engine), identifier)
      .translate(listOf("Eins", "Zwei", "Drei")) { index, _ -> synchronized(reported) { reported.add(index) } }

    assertEquals(
      listOf("[mlkit de>en] Eins", "[mlkit de>en] Zwei", "[mlkit de>en] Drei"),
      outcomes.map { output(it)?.text }
    )
    assertEquals(listOf(listOf("Eins", "Zwei", "Drei")), engine.batches)
    assertEquals(listOf(0, 1, 2), reported.sorted())
  }

  @Test
  fun identifiedTextsAreGroupedByLanguage() = runBlocking {
    val engine = FakeEngine("mlkit", installed = setOf("de", "fr"))
    val outcomes = TranslatorCore(options(), listOf(engine), identifier).translate(
      listOf("Der Zug ist spät.", "Le train est en retard.", "Ein Kaffee, bitte.")
    )

    assertEquals(listOf("de", "fr", "de"), outcomes.map { output(it)?.sourceLanguage })
    assertEquals(setOf(1, 2), engine.batches.map { it.size }.toSet())
  }

  @Test
  fun textAlreadyInTheTargetComesBackUntouched() = runBlocking {
    val engine = FakeEngine("mlkit", installed = setOf("de"))
    val outcomes = TranslatorCore(options(), listOf(engine), identifier)
      .translate(listOf("The quick brown fox.", "  "))

    assertEquals(listOf("The quick brown fox.", "  "), outcomes.map { output(it)?.text })
    assertEquals(listOf<String?>(null, null), outcomes.map { output(it)?.engine })
    assertTrue(engine.batches.isEmpty())
  }

  @Test
  fun anUnidentifiableTextFailsAlone() = runBlocking {
    val engine = FakeEngine("mlkit", installed = setOf("de"))
    val outcomes = TranslatorCore(options(), listOf(engine), identifier).translate(listOf("???", "Der Zug."))

    assertEquals(TranslationFailure.UNABLE_TO_IDENTIFY, failure(outcomes[0]))
    assertEquals("[mlkit de>en] Der Zug.", output(outcomes[1])?.text)
  }

  @Test
  fun prefersAnEngineThatHasTheLanguagesAlready() = runBlocking {
    val first = FakeEngine("first", downloadable = setOf("de"))
    val second = FakeEngine("second", installed = setOf("de"))
    val outcomes = TranslatorCore(options(from = "de"), listOf(first, second), identifier).translate(listOf("Hallo"))

    assertEquals("second", output(outcomes[0])?.engine)
  }

  @Test
  fun unsupportedAndNotInstalled() = runBlocking {
    val engine = FakeEngine("mlkit", downloadable = setOf("de"))
    val unsupported = TranslatorCore(options(from = "xx"), listOf(engine), identifier).translate(listOf("?"))
    val noDownload = TranslatorCore(options(from = "de", download = false), listOf(engine), identifier)
      .translate(listOf("Hallo"))

    assertEquals(TranslationFailure.UNSUPPORTED_LANGUAGE, failure(unsupported[0]))
    assertEquals(TranslationFailure.NOT_INSTALLED, failure(noDownload[0]))
    assertTrue(engine.batches.isEmpty())
  }

  @Test
  fun oneFailingLanguageFailsOnlyItsTexts() = runBlocking {
    val engine = FakeEngine("mlkit", installed = setOf("de", "fr"), failing = setOf("fr"))
    val outcomes = TranslatorCore(options(), listOf(engine), identifier)
      .translate(listOf("Der Zug ist spät.", "Le train est en retard."))

    assertEquals("[mlkit de>en] Der Zug ist spät.", output(outcomes[0])?.text)
    assertEquals(TranslationFailure.UNKNOWN, failure(outcomes[1]))
  }

  @Test
  fun prepareDownloadsTheGivenPairOnly() = runBlocking {
    val engine = FakeEngine("mlkit", downloadable = setOf("de"))

    TranslatorCore(options(from = "de"), listOf(engine), identifier).prepare()
    TranslatorCore(options(), listOf(engine), identifier).prepare()
    assertEquals(listOf("de"), engine.downloads)
  }
}
