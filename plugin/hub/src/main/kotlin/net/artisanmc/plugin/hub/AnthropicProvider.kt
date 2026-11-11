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
        // The longest silence between two pieces of a streamed answer (the API pings meanwhile).
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

        override fun step(input: List<AiInput>): AiReply = stream(input) {}

        @Synchronized
        override fun stream(input: List<AiInput>, live: (AiDelta) -> Unit): AiReply {
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
            // Streamed: the editor shows the answer as it is written ([live]).
            body.put("stream", true)
            val request = Request.Builder().url(endpoint)
                .header("x-api-key", config.apiKey)
                .header("anthropic-version", API_VERSION)
            // A refusal by a safety classifier is retried on another model the API picks.
            if (config.model in FALLBACK_MODELS && config.baseUrl.isBlank()) {
                request.header("anthropic-beta", FALLBACK_BETA)
                body.put("fallbacks", "default")
            }
            val response = try {
                send(request.post(Call.mapper.writeValueAsBytes(body).toRequestBody(JSON)).build(), live)
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

    /**
     * The answer's JSON, put together from its stream as the API sends it (each piece also told to
     * [live]), or the failure the editor shows: key refused, rate limit, provider error, unreachable.
     */
    private fun send(request: Request, live: (AiDelta) -> Unit): JsonNode {
        val (status, text) = try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use response.code to response.body?.string().orEmpty()
                val source = response.body?.source() ?: return@use response.code to ""
                val answer = StreamedAnswer(live)
                var event = ""
                val data = StringBuilder()
                while (true) {
                    val line = source.readUtf8Line() ?: break
                    when {
                        line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                        line.startsWith("data:") -> data.append(line.removePrefix("data:").trimStart())
                        line.isEmpty() && data.isNotEmpty() -> {
                            answer.on(event, Call.mapper.readTree(data.toString()))
                            event = ""
                            data.setLength(0)
                        }
                    }
                }
                return answer.message() ?: throw AiFailure("ai_provider_error", "Anthropic's stream ended before the answer did")
            }
        } catch (e: IOException) {
            throw AiFailure("ai_unreachable", "Anthropic could not be reached: ${e.message}", e)
        }
        failed(status, text)
    }

    private fun failed(status: Int, text: String): Nothing {
        val body = runCatching { Call.mapper.readTree(text) }.getOrNull()
        val message = body?.path("error")?.path("message")?.asText()?.takeIf { it.isNotBlank() } ?: text.take(200)
        throw when (status) {
            401 -> AiFailure("ai_key_refused", "Anthropic refused the API key")
            403 -> AiFailure("ai_key_refused", "Anthropic refused the API key: $message")
            429 -> AiFailure("ai_rate_limited", "Anthropic rate limit: $message")
            else -> AiFailure("ai_provider_error", "Anthropic answered $status: $message")
        }
    }

    /**
     * An answer as its stream builds it (the Messages API's events): the message with its blocks,
     * text and thinking grown piece by piece, a tool call's input parsed once its block closes.
     */
    private class StreamedAnswer(private val live: (AiDelta) -> Unit) {
        private var message: ObjectNode? = null
        private var done = false
        private val blocks = sortedMapOf<Int, ObjectNode>()
        private val inputs = mutableMapOf<Int, StringBuilder>()
        private val texts = mutableMapOf<Int, Int>()

        fun on(event: String, data: JsonNode) {
            val type = data.path("type").asText(event)
            val index = data.path("index").asInt()
            when (type) {
                "message_start" -> message = (data.path("message") as? ObjectNode)?.deepCopy()
                "content_block_start" -> {
                    val block = (data.path("content_block") as? ObjectNode)?.deepCopy() ?: return
                    blocks[index] = block
                    if (block.path("type").asText() == "tool_use") {
                        inputs[index] = StringBuilder()
                        tell(AiDelta.ToolStart(block.path("id").asText(), block.path("name").asText()))
                    }
                }
                "content_block_delta" -> {
                    val block = blocks[index] ?: return
                    val delta = data.path("delta")
                    when (delta.path("type").asText()) {
                        "text_delta" -> {
                            val piece = delta.path("text").asText()
                            block.put("text", block.path("text").asText() + piece)
                            tell(AiDelta.Text(texts.getOrPut(index) { texts.size }, piece))
                        }
                        "thinking_delta" -> block.put("thinking", block.path("thinking").asText() + delta.path("thinking").asText())
                        "signature_delta" -> block.put("signature", delta.path("signature").asText())
                        "input_json_delta" -> {
                            val piece = delta.path("partial_json").asText()
                            inputs[index]?.append(piece)
                            tell(AiDelta.ToolInput(block.path("id").asText(), piece))
                        }
                    }
                }
                "content_block_stop" -> {
                    val raw = inputs.remove(index)?.toString() ?: return
                    blocks[index]?.set<JsonNode>("input", if (raw.isBlank()) json.objectNode() else Call.mapper.readTree(raw))
                }
                "message_delta" -> message?.let { m ->
                    data.path("delta").fields().forEach { (key, value) -> m.set<JsonNode>(key, value) }
                    val usage = (m.get("usage") as? ObjectNode) ?: m.putObject("usage")
                    data.path("usage").fields().forEach { (key, value) -> if (!value.isNull) usage.set<JsonNode>(key, value) }
                }
                "message_stop" -> done = true
                "error" -> {
                    val error = data.path("error")
                    throw AiFailure(
                        if (error.path("type").asText() == "rate_limit_error") "ai_rate_limited" else "ai_provider_error",
                        "Anthropic's stream failed: ${error.path("message").asText()}",
                    )
                }
            }
        }

        /** The whole answer, once the stream said it ended; null before. */
        fun message(): JsonNode? {
            val m = message?.takeIf { done } ?: return null
            return m.set<ObjectNode>("content", json.arrayNode().addAll(blocks.values))
        }

        /** A listener that fails never stops the answer. */
        private fun tell(delta: AiDelta) {
            runCatching { live(delta) }
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
        val declared = json.objectNode().put("name", tool.name).put("description", tool.description).set<ObjectNode>("input_schema", schema)
        // The input streams as the model writes it: a file being written shows before the call ends.
        // Not through another address: a proxy may refuse the field.
        if (config.baseUrl.isBlank()) declared.put("eager_input_streaming", true)
        return declared
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
