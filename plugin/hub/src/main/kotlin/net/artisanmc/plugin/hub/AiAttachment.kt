package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.Base64

/**
 * A file the player gave the assistant with a message (ADR `editor-assistant`): uploaded from
 * their computer or picked among the server's module files, the editor sends its bytes either way.
 * Its [kind] comes from the bytes, never from a name or a declared type.
 */
class AiAttachment(
    val name: String,
    val kind: Kind,
    val bytes: ByteArray,
    /** Picked on the server: the module (Project id) and the file's path in it. */
    val project: String? = null,
    val path: String? = null,
) {
    enum class Kind(val id: String) { IMAGE("image"), PDF("pdf"), TEXT("text") }

    /** `image/png` … for an image; `application/pdf`; `text/plain`. */
    val mediaType: String = when (kind) {
        Kind.IMAGE -> imageType(bytes)!!
        Kind.PDF -> "application/pdf"
        Kind.TEXT -> "text/plain"
    }

    /** What the conversation's events keep: never the bytes. */
    fun describe(): Map<String, Any?> = mapOf("name" to name, "kind" to kind.id, "size" to bytes.size, "project" to project, "path" to path).filterValues { it != null }

    /** What the model reads. A text file goes in as text, in a block that says it is data. */
    fun input(): AiInput = when (kind) {
        Kind.IMAGE -> AiInput.Image(name, mediaType, base64())
        Kind.PDF -> AiInput.Pdf(name, base64())
        Kind.TEXT -> AiInput.Text(
            buildString {
                append("<attachment name=\"").append(attribute(name)).append('"')
                if (project != null) append(" module=\"").append(attribute(project)).append('"')
                if (path != null) append(" path=\"").append(attribute(path)).append('"')
                append(">\n").append(text(bytes)).append("\n</attachment>")
            },
        )
    }

    private fun base64() = Base64.getEncoder().encodeToString(bytes)

    sealed interface Parsed {
        data class Valid(val attachments: List<AiAttachment>) : Parsed
        data class Invalid(val status: Int, val code: String) : Parsed
    }

    companion object {
        const val MAX_FILES = 5
        /** One image as the provider takes it (5 MB once in base64). */
        const val MAX_IMAGE = 3_750_000
        const val MAX_PDF = 6_000_000
        const val MAX_TEXT_CHARS = 200_000
        /** Every file of one message. */
        const val MAX_MESSAGE = 6_000_000
        /** Every file of one conversation: each one stays in the history the model rereads, and in the database. */
        const val MAX_CONVERSATION = 16_000_000
        private const val MAX_NAME = 200

        /** The `attachments` of a message, checked; an absent or empty list is valid. */
        fun parse(node: JsonNode?): Parsed {
            if (node == null || node.isMissingNode || node.isNull) return Parsed.Valid(emptyList())
            if (!node.isArray || node.size() > MAX_FILES) return Parsed.Invalid(422, "invalid_input")
            val attachments = node.map { item ->
                val name = item.path("name").asText("").trim().take(MAX_NAME).ifEmpty { return Parsed.Invalid(422, "invalid_input") }
                val bytes = runCatching { Base64.getDecoder().decode(item.path("data").asText("")) }.getOrNull()
                    ?.takeIf { it.isNotEmpty() } ?: return Parsed.Invalid(422, "invalid_input")
                val project = item.path("project").asText("").takeIf { it.isNotBlank() }?.take(200)
                val path = item.path("path").asText("").takeIf { it.isNotBlank() }?.take(500)
                val kind = kindOf(bytes) ?: return Parsed.Invalid(422, "ai_attachment_unsupported")
                val limit = when (kind) {
                    Kind.IMAGE -> bytes.size <= MAX_IMAGE
                    Kind.PDF -> bytes.size <= MAX_PDF
                    Kind.TEXT -> text(bytes).length <= MAX_TEXT_CHARS
                }
                if (!limit) return Parsed.Invalid(413, "ai_attachment_too_large")
                AiAttachment(name, kind, bytes, project, path)
            }
            if (attachments.sumOf { it.bytes.size } > MAX_MESSAGE) return Parsed.Invalid(413, "ai_attachment_too_large")
            return Parsed.Valid(attachments)
        }

        /** An image or a PDF by its first bytes, text when it is UTF-8 without a NUL; null: neither. */
        fun kindOf(bytes: ByteArray): Kind? = when {
            imageType(bytes) != null -> Kind.IMAGE
            starts(bytes, "%PDF-".toByteArray()) -> Kind.PDF
            bytes.none { it == 0.toByte() } && runCatching { text(bytes) }.isSuccess -> Kind.TEXT
            else -> null
        }

        private fun imageType(bytes: ByteArray): String? = when {
            starts(bytes, byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte())) -> "image/png"
            starts(bytes, byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())) -> "image/jpeg"
            starts(bytes, "GIF8".toByteArray()) -> "image/gif"
            starts(bytes, "RIFF".toByteArray()) && bytes.size >= 12 && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
            else -> null
        }

        private fun starts(bytes: ByteArray, prefix: ByteArray) = bytes.size >= prefix.size && prefix.indices.all { bytes[it] == prefix[it] }

        /** Strict UTF-8, its byte order mark dropped. */
        private fun text(bytes: ByteArray): String {
            val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
            val text = try {
                decoder.decode(ByteBuffer.wrap(bytes)).toString()
            } catch (e: CharacterCodingException) {
                throw IllegalArgumentException("not UTF-8", e)
            }
            return text.removePrefix("﻿")
        }

        private fun attribute(value: String) = value.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace("\n", " ")
    }
}
