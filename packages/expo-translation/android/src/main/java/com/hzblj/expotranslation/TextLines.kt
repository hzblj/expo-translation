package com.hzblj.expotranslation

/**
 * A text split into lines and the line breaks between them, for ML Kit, which loses line breaks: each line is
 * translated on its own and the breaks are put back as they were, with each line's surrounding spaces. The same rules
 * as `TextLines` in `ios/Core/Engine.swift`.
 */
class TextLines(text: String) {
  sealed class Part {
    data class Line(val leading: String, val text: String, val trailing: String) : Part()
    data class Verbatim(val text: String) : Part()
  }

  val parts: List<Part>

  init {
    val result = mutableListOf<Part>()
    val current = StringBuilder()

    fun flushLine() {
      if (current.isEmpty()) {
        return
      }
      // No line breaks in here: they end a line.
      val line = current.toString()
      val trimmed = line.trim()

      if (trimmed.isEmpty()) {
        result.add(Part.Verbatim(line))
      } else {
        val leading = line.takeWhile { it.isWhitespace() }
        val trailing = line.takeLastWhile { it.isWhitespace() }
        result.add(Part.Line(leading, trimmed, trailing))
      }
      current.clear()
    }

    for (character in text) {
      if (character == '\n' || character == '\r') {
        flushLine()
        val last = result.lastOrNull()
        if (last is Part.Verbatim) {
          result[result.size - 1] = Part.Verbatim(last.text + character)
        } else {
          result.add(Part.Verbatim(character.toString()))
        }
      } else {
        current.append(character)
      }
    }
    flushLine()
    parts = result
  }

  /** The lines to translate, in order. */
  val lines: List<String> get() = parts.filterIsInstance<Part.Line>().map { it.text }

  /** The text again, with the lines replaced by these, in order. */
  fun joined(translated: List<String>): String {
    var index = 0

    return parts.joinToString("") { part ->
      when (part) {
        is Part.Verbatim -> part.text
        is Part.Line -> (part.leading + (translated.getOrNull(index) ?: part.text) + part.trailing).also { index++ }
      }
    }
  }
}
