package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.JsonNodeFactory
import com.fasterxml.jackson.databind.node.ObjectNode
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URI
import java.time.Duration
import java.util.UUID

/**
 * A model behind an OpenAI-compatible Chat Completions API: OpenAI itself, or, through
 * [AiConfig.baseUrl], DeepSeek, Mistral, OpenRouter, a local Ollama… (ADR `editor-assistant`).
 * One implementation for all of them: only what every one of them reads is sent. No `max_tokens`
 * (DeepSeek caps it lower than others), no effort (a model without reasoning refuses the field).
 *
 * The history is the API's own messages, the system prompt left out (sent first on each step).
 */
class OpenAiProvider(
    private val config: AiConfig,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(10))
        // The longest silence between two pieces of a streamed answer (a reasoning model may think long first).
        .readTimeout(Duration.ofMinutes(10))
        .build(),
) : AiProvider {
    private val base = config.baseUrl.ifBlank { DEFAULT_BASE_URL }.trimEnd('/')
    private val endpoint = "$base/chat/completions"
    private val host = runCatching { URI(base).host }.getOrNull().orEmpty().lowercase()

    override val model: String get() = config.model

    override val historyKey: String get() = "openai|${config.baseUrl}|${config.model}"

    /** What the vendor reads: DeepSeek no images, PDFs only OpenAI and OpenRouter. A model may still refuse an image it cannot see. */
    override val attachments: Set<AiAttachment.Kind> = when {
        host.isDeepSeek() -> setOf(AiAttachment.Kind.TEXT)
        host == "api.openai.com" || host.endsWith("openrouter.ai") -> AiAttachment.Kind.entries.toSet()
        else -> setOf(AiAttachment.Kind.TEXT, AiAttachment.Kind.IMAGE)
    }

    override fun conversation(system: String, tools: List<McpTools.Tool>): AiConversation = Chat(system, tools.map(::declare), mutableListOf())

    override fun resume(system: String, tools: List<McpTools.Tool>, history: String): AiConversation? {
        val messages = runCatching { Call.mapper.readTree(history) }.getOrNull()
            ?.takeIf { it.isArray && it.all { message -> message.path("role").isTextual } } ?: return null
        // Stopped between a message sent and its answer: that message goes again with the next one.
        val kept = messages.toList().dropLastWhile { it["role"].asText() in setOf(USER, TOOL) }
        return Chat(system, tools.map(::declare), kept.toMutableList())
    }

    private inner class Chat(
        private val system: String,
        private val declared: List<JsonNode>,
        private val history: MutableList<JsonNode>,
    ) : AiConversation {
        /** Tool calls of the last answer that no result followed: the turn stopped (a restart, an error) before it sent them. */
        private var unanswered: List<String> = history.lastOrNull()?.takeIf { it["role"].asText() == ASSISTANT }
            ?.path("tool_calls")?.map { it.path("id").asText() }.orEmpty()

        @Synchronized
        override fun history(): String = Call.mapper.writeValueAsString(history)

        override fun step(input: List<AiInput>): AiReply = stream(input) {}

        @Synchronized
        override fun stream(input: List<AiInput>, live: (AiDelta) -> Unit): AiReply {
            val answered = input.filterIsInstance<AiInput.ToolResult>().map { it.callId }.toSet()
            val interrupted = unanswered.filter { it !in answered }
                .map { AiInput.ToolResult(it, """{"error":"interrupted","message":"The turn stopped before this result was sent; check what the call did before doing it again."}""", true) }
            val added = messages(interrupted + input)
            history.addAll(added)
            val body = json.objectNode().put("model", config.model)
            val messages = body.putArray("messages")
            messages.addObject().put("role", SYSTEM).put("content", system)
            messages.addAll(history)
            if (declared.isNotEmpty()) body.set<ObjectNode>("tools", json.arrayNode().addAll(declared))
            // Streamed: the editor shows the answer as it is written ([live]).
            body.put("stream", true)
            // The tokens spent, in a last piece. Mistral refuses the field (and counts them anyway).
            if (!host.endsWith("mistral.ai")) body.set<ObjectNode>("stream_options", json.objectNode().put("include_usage", true))
            val request = Request.Builder().url(endpoint)
                .header("Authorization", "Bearer ${config.apiKey}")
                .post(Call.mapper.writeValueAsBytes(body).toRequestBody(JSON))
                .build()
            val answer = try {
                send(request, live)
            } catch (e: Exception) {
                // The message stays out of the history: the next one is sent after the last answer.
                repeat(added.size) { history.removeAt(history.lastIndex) }
                throw e
            }
            history.add(answer.message())
            unanswered = answer.calls.map { it.id }
            val stop = when (answer.finish) {
                "tool_calls", "function_call" -> AiReply.TOOLS
                "length" -> AiReply.LIMIT
                "content_filter" -> AiReply.REFUSED
                else -> if (answer.calls.isNotEmpty()) AiReply.TOOLS else AiReply.END
            }
            return AiReply(listOf(answer.text.toString()).filter { it.isNotBlank() }, answer.calls, stop, answer.inputTokens, answer.outputTokens)
        }
    }

    /** [input] as the API's messages: each tool result its own `tool` message, the rest one `user` message after them. */
    private fun messages(input: List<AiInput>): List<JsonNode> {
        val results = input.filterIsInstance<AiInput.ToolResult>().map { result ->
            // No error flag in this API: a failed call's result says so itself (`{"error":…}`).
            json.objectNode().put("role", TOOL).put("tool_call_id", result.callId).put("content", result.json)
        }
        val parts = input.filter { it !is AiInput.ToolResult }
        if (parts.isEmpty()) return results
        val user = json.objectNode().put("role", USER)
        val only = parts.singleOrNull() as? AiInput.Text
        // Plain text as a string: some compatible APIs (DeepSeek) read no other form.
        if (only != null) user.put("content", only.text)
        else if (parts.all { it is AiInput.Text }) user.put("content", parts.joinToString("\n\n") { (it as AiInput.Text).text })
        else user.set<ArrayNode>("content", json.arrayNode().addAll(parts.map(::part)))
        // A node is Iterable: `+ user` would add its fields.
        return results + listOf(user)
    }

    private fun part(input: AiInput): JsonNode = when (input) {
        is AiInput.Text -> json.objectNode().put("type", "text").put("text", input.text)
        is AiInput.Image -> json.objectNode().put("type", "image_url")
            .set<ObjectNode>("image_url", json.objectNode().put("url", "data:${input.mediaType};base64,${input.base64}"))
        is AiInput.Pdf -> json.objectNode().put("type", "file")
            .set<ObjectNode>("file", json.objectNode().put("filename", input.name).put("file_data", "data:application/pdf;base64,${input.base64}"))
        is AiInput.ToolResult -> error("a tool result is its own message")
    }

    /** The answer put together from its stream, or the failure the editor shows. */
    private fun send(request: Request, live: (AiDelta) -> Unit): StreamedAnswer {
        val (status, text) = try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use response.code to response.body?.string().orEmpty()
                val source = response.body?.source() ?: return@use response.code to ""
                val answer = StreamedAnswer(live)
                var ended = false
                while (true) {
                    val line = source.readUtf8Line() ?: break
                    if (!line.startsWith("data:")) continue
                    val data = line.removePrefix("data:").trim()
                    if (data == "[DONE]") {
                        ended = true
                        break
                    }
                    if (data.isNotEmpty()) answer.on(Call.mapper.readTree(data))
                }
                if (!ended && answer.finish == null) throw AiFailure("ai_provider_error", "The model's stream ended before the answer did")
                return answer
            }
        } catch (e: IOException) {
            throw AiFailure("ai_unreachable", "$host could not be reached: ${e.message}", e)
        }
        failed(status, text)
    }

    private fun failed(status: Int, text: String): Nothing {
        val message = errorMessage(runCatching { Call.mapper.readTree(text) }.getOrNull()) ?: text.take(200)
        throw when (status) {
            401, 403 -> AiFailure("ai_key_refused", "$host refused the API key: $message")
            // DeepSeek says 402 when the balance is spent: the key works, the account cannot pay.
            402, 429 -> AiFailure("ai_rate_limited", "$host limit: $message")
            else -> AiFailure("ai_provider_error", "$host answered $status: $message")
        }
    }

    /** `{"error":{"message":…}}` (OpenAI and most) or `{"error":"…"}` (Ollama). */
    private fun errorMessage(body: JsonNode?): String? {
        val error = body?.get("error") ?: return null
        return (if (error.isTextual) error.asText() else error.path("message").asText()).takeIf { it.isNotBlank() }
    }

    /** An answer as its chunks build it: the text, the reasoning some models show, each tool call by its index. */
    private inner class StreamedAnswer(private val live: (AiDelta) -> Unit) {
        val text = StringBuilder()
        private val reasoning = StringBuilder()
        private val tools = sortedMapOf<Int, Pair<String, String>>()
        private val arguments = mutableMapOf<Int, StringBuilder>()
        var finish: String? = null
        var inputTokens = 0L
        var outputTokens = 0L

        val calls: List<AiToolCall> by lazy {
            tools.map { (index, call) ->
                val raw = arguments[index]?.toString().orEmpty()
                // Arguments that do not parse go as none: the tool says what is missing.
                val input = runCatching { Call.mapper.readTree(raw) }.getOrNull()?.takeIf { it.isObject } ?: json.objectNode()
                AiToolCall(call.first, call.second, input)
            }
        }

        fun on(chunk: JsonNode) {
            errorMessage(chunk)?.let { throw AiFailure("ai_provider_error", "$host's stream failed: $it") }
            chunk.path("usage").takeIf { it.isObject }?.let { usage ->
                inputTokens = usage.path("prompt_tokens").asLong(inputTokens)
                outputTokens = usage.path("completion_tokens").asLong(outputTokens)
            }
            val choice = chunk.path("choices").path(0)
            if (choice.isMissingNode) return
            val delta = choice.path("delta")
            delta.path("content").takeIf { it.isTextual && it.asText().isNotEmpty() }?.let {
                text.append(it.asText())
                tell(AiDelta.Text(0, it.asText()))
            }
            delta.path("reasoning_content").takeIf { it.isTextual }?.let { reasoning.append(it.asText()) }
            delta.path("tool_calls").forEach { call ->
                val index = call.path("index").asInt(tools.size)
                val function = call.path("function")
                if (index !in tools) {
                    val id = call.path("id").asText("").ifBlank { "call_" + UUID.randomUUID().toString().replace("-", "").take(24) }
                    tools[index] = id to function.path("name").asText()
                    arguments[index] = StringBuilder()
                    tell(AiDelta.ToolStart(id, tools.getValue(index).second))
                } else if (tools.getValue(index).second.isEmpty() && function.path("name").asText().isNotEmpty()) {
                    tools[index] = tools.getValue(index).first to function.path("name").asText()
                }
                val piece = function.path("arguments").asText("")
                if (piece.isNotEmpty()) {
                    arguments.getValue(index).append(piece)
                    tell(AiDelta.ToolInput(tools.getValue(index).first, piece))
                }
            }
            choice.path("finish_reason").takeIf { it.isTextual }?.let { finish = it.asText() }
        }

        /** The answer as it goes back in the history. */
        fun message(): JsonNode {
            val message = json.objectNode().put("role", ASSISTANT).put("content", text.toString())
            // A reasoning model (DeepSeek) reads its reasoning back within a turn of tool calls.
            if (reasoning.isNotEmpty()) message.put("reasoning_content", reasoning.toString())
            if (calls.isNotEmpty()) {
                message.set<ArrayNode>(
                    "tool_calls",
                    json.arrayNode().addAll(
                        calls.mapIndexed { i, call ->
                            json.objectNode().put("id", call.id).put("type", "function").set<ObjectNode>(
                                "function",
                                json.objectNode().put("name", call.name).put("arguments", arguments[tools.keys.elementAt(i)].toString()),
                            )
                        },
                    ),
                )
            }
            return message
        }

        /** A listener that fails never stops the answer. */
        private fun tell(delta: AiDelta) {
            runCatching { live(delta) }
        }
    }

    private fun declare(tool: McpTools.Tool): JsonNode {
        val schema = json.objectNode().put("type", "object")
        schema.set<ObjectNode>("properties", Call.mapper.valueToTree(tool.input["properties"] ?: emptyMap<String, Any?>()))
        (tool.input["required"] as? List<*>)?.let { required -> schema.set<ObjectNode>("required", json.arrayNode().apply { required.forEach { add(it.toString()) } }) }
        val function = json.objectNode().put("name", tool.name).put("description", tool.description).set<ObjectNode>("parameters", schema)
        return json.objectNode().put("type", "function").set<ObjectNode>("function", function)
    }

    private fun String.isDeepSeek() = this == "deepseek.com" || endsWith(".deepseek.com")

    private companion object {
        val json: JsonNodeFactory = JsonNodeFactory.instance
        val JSON = "application/json".toMediaType()
        const val SYSTEM = "system"
        const val USER = "user"
        const val ASSISTANT = "assistant"
        const val TOOL = "tool"
        const val DEFAULT_BASE_URL = "https://api.openai.com/v1"
    }
}
