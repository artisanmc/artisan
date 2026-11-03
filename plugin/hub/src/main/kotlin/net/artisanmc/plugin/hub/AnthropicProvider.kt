package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.JsonNodeFactory
import com.fasterxml.jackson.databind.node.ObjectNode
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.Duration

/**
 * Claude through Anthropic's Messages API, over plain HTTP (the official SDK weighed 16 MB in the jar
 * for one endpoint). The history is append-only, in the API's own JSON: each answer goes back exactly
 * as it came (thinking blocks included), which the newest models require. Tools and the system prompt
 * never change within a conversation, so the cache hits.
 */
class AnthropicProvider(
    private val config: AiConfig,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(10))
        // A long answer at a high effort: the API's own limit for a non-streamed call.
        .readTimeout(Duration.ofMinutes(10))
        .build(),
) : AiProvider {
    private val endpoint = config.baseUrl.ifBlank { DEFAULT_BASE_URL }.trimEnd('/') + "/v1/messages"

    override val model: String get() = config.model

    override val historyKey: String get() = "anthropic|${config.baseUrl}|${config.model}"

    override fun conversation(system: String, tools: List<McpTools.Tool>): AiConversation = Chat(system, tools.map(::declare), mutableListOf())

    override fun resume(system: String, tools: List<McpTools.Tool>, history: String): AiConversation? {
        val messages = runCatching { Call.mapper.readTree(history) }.getOrNull()
            ?.takeIf { it.isArray && it.all { message -> message.path("role").isTextual } } ?: return null
        // Stopped between a message sent and its answer: that message goes again with the next one.
        val kept = messages.toList().dropLastWhile { it["role"].asText() == USER }
        return Chat(system, tools.map(::declare), kept.toMutableList())
    }

    private inner class Chat(
        private val system: String,
        private val declared: List<JsonNode>,
        private val history: MutableList<JsonNode>,
    ) : AiConversation {
        /** Tool calls of the last answer that no result followed: the turn stopped (a restart, an error) before it sent them. */
        private var unanswered: List<String> = history.lastOrNull()?.takeIf { it["role"].asText() == ASSISTANT }
            ?.path("content")?.filter { it.path("type").asText() == "tool_use" }?.map { it["id"].asText() }.orEmpty()

        @Synchronized
        override fun history(): String = Call.mapper.writeValueAsString(history)

        @Synchronized
        override fun step(input: List<AiInput>): AiReply {
            val answered = input.filterIsInstance<AiInput.ToolResult>().map { it.callId }.toSet()
            val interrupted = unanswered.filter { it !in answered }
                .map { AiInput.ToolResult(it, """{"error":"interrupted","message":"The turn stopped before this result was sent; check what the call did before doing it again."}""", true) }
            history.add(json.objectNode().put("role", USER).set<ObjectNode>("content", json.arrayNode().addAll((interrupted + input).map(::block))))
            val body = json.objectNode()
                .put("model", config.model)
                .put("max_tokens", MAX_TOKENS)
                .put("system", system)
            if (declared.isNotEmpty()) body.set<ObjectNode>("tools", json.arrayNode().addAll(declared))
            body.set<ObjectNode>("messages", json.arrayNode().addAll(history))
            // Caches tools + system + history up to the last message: each step rereads them.
            body.set<ObjectNode>("cache_control", json.objectNode().put("type", "ephemeral"))
            body.set<ObjectNode>("output_config", json.objectNode().put("effort", config.effort))
            val request = Request.Builder().url(endpoint)
                .header("x-api-key", config.apiKey)
                .header("anthropic-version", API_VERSION)
            // A refusal by a safety classifier is retried on another model the API picks.
            if (config.model in FALLBACK_MODELS && config.baseUrl.isBlank()) {
                request.header("anthropic-beta", FALLBACK_BETA)
                body.put("fallbacks", "default")
            }
            val response = try {
                send(request.post(Call.mapper.writeValueAsBytes(body).toRequestBody(JSON)).build())
            } catch (e: Exception) {
                // The message stays out of the history: the next one is sent after the last answer.
                history.removeAt(history.lastIndex)
                throw e
            }
            val content = response.path("content").filter { it.isObject }
            history.add(json.objectNode().put("role", ASSISTANT).set<ObjectNode>("content", json.arrayNode().addAll(content.map(::param))))
            val texts = content.filter { it.path("type").asText() == "text" }.map { it.path("text").asText() }.filter { it.isNotBlank() }
            val calls = content.filter { it.path("type").asText() == "tool_use" }
                .map { AiToolCall(it["id"].asText(), it["name"].asText(), it.path("input")) }
            unanswered = calls.map { it.id }
            val stop = when (response.path("stop_reason").asText()) {
                "tool_use" -> AiReply.TOOLS
                "max_tokens" -> AiReply.LIMIT
                "refusal" -> AiReply.REFUSED
                else -> if (calls.isNotEmpty()) AiReply.TOOLS else AiReply.END
            }
            val usage = response.path("usage")
            return AiReply(texts, calls, stop, usage.path("input_tokens").asLong(), usage.path("output_tokens").asLong())
        }
    }

    /** The answer's JSON, or the failure the editor shows: key refused, rate limit, provider error, unreachable. */
    private fun send(request: Request): JsonNode {
        val (status, text) = try {
            client.newCall(request).execute().use { it.code to it.body?.string().orEmpty() }
        } catch (e: IOException) {
            throw AiFailure("ai_unreachable", "Anthropic could not be reached: ${e.message}", e)
        }
        val body = runCatching { Call.mapper.readTree(text) }.getOrNull()
        if (status in 200..299 && body != null && body.isObject) return body
        val message = body?.path("error")?.path("message")?.asText()?.takeIf { it.isNotBlank() } ?: text.take(200)
        throw when (status) {
            401 -> AiFailure("ai_key_refused", "Anthropic refused the API key")
            403 -> AiFailure("ai_key_refused", "Anthropic refused the API key: $message")
            429 -> AiFailure("ai_rate_limited", "Anthropic rate limit: $message")
            else -> AiFailure("ai_provider_error", "Anthropic answered $status: $message")
        }
    }

    /** An answer's block as it goes back in the history: what the API reads, without the fields only an answer carries. */
    private fun param(block: JsonNode): JsonNode {
        val keep = when (block.path("type").asText()) {
            "text" -> listOf("type", "text")
            "thinking" -> listOf("type", "thinking", "signature")
            "redacted_thinking" -> listOf("type", "data")
            "tool_use" -> listOf("type", "id", "name", "input")
            else -> return block
        }
        return json.objectNode().apply { keep.forEach { key -> block.get(key)?.let { set<JsonNode>(key, it) } } }
    }

    private fun block(input: AiInput): JsonNode = when (input) {
        is AiInput.Text -> json.objectNode().put("type", "text").put("text", input.text)
        is AiInput.ToolResult -> json.objectNode().put("type", "tool_result").put("tool_use_id", input.callId)
            .put("content", input.json).put("is_error", input.error)
        is AiInput.Image -> json.objectNode().put("type", "image").set<ObjectNode>(
            "source", json.objectNode().put("type", "base64").put("media_type", input.mediaType).put("data", input.base64),
        )
        is AiInput.Pdf -> json.objectNode().put("type", "document").put("title", input.name).set<ObjectNode>(
            "source", json.objectNode().put("type", "base64").put("media_type", "application/pdf").put("data", input.base64),
        )
    }

    private fun declare(tool: McpTools.Tool): JsonNode {
        val schema = json.objectNode().put("type", "object")
        schema.set<ObjectNode>("properties", Call.mapper.valueToTree(tool.input["properties"] ?: emptyMap<String, Any?>()))
        (tool.input["required"] as? List<*>)?.let { required -> schema.set<ObjectNode>("required", json.arrayNode().apply { required.forEach { add(it.toString()) } }) }
        schema.put("additionalProperties", false)
        return json.objectNode().put("name", tool.name).put("description", tool.description).set<ObjectNode>("input_schema", schema)
    }

    private companion object {
        val json: JsonNodeFactory = JsonNodeFactory.instance
        val JSON = "application/json".toMediaType()
        const val USER = "user"
        const val ASSISTANT = "assistant"
        const val DEFAULT_BASE_URL = "https://api.anthropic.com"
        const val API_VERSION = "2023-06-01"
        const val MAX_TOKENS = 16_000L
        const val FALLBACK_BETA = "server-side-fallback-2026-07-01"
        val FALLBACK_MODELS = setOf("claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")
    }
}
