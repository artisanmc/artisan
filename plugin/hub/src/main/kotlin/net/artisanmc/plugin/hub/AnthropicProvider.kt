package net.artisanmc.plugin.hub

import com.anthropic.client.AnthropicClient
import com.anthropic.client.okhttp.AnthropicOkHttpClient
import com.anthropic.core.JsonValue
import com.anthropic.core.jsonMapper
import com.anthropic.errors.AnthropicIoException
import com.anthropic.errors.AnthropicServiceException
import com.anthropic.errors.PermissionDeniedException
import com.anthropic.errors.RateLimitException
import com.anthropic.errors.UnauthorizedException
import com.anthropic.models.messages.CacheControlEphemeral
import com.anthropic.models.messages.ContentBlockParam
import com.anthropic.models.messages.MessageCreateParams
import com.anthropic.models.messages.MessageParam
import com.anthropic.models.messages.OutputConfig
import com.anthropic.models.messages.StopReason
import com.anthropic.models.messages.TextBlockParam
import com.anthropic.models.messages.Tool
import com.anthropic.models.messages.ToolResultBlockParam
import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.JsonNode

/**
 * Claude through Anthropic's Messages API, with the official SDK. The history is append-only:
 * each answer goes back exactly as it came (thinking blocks included), which the newest models
 * require. Tools and the system prompt never change within a conversation, so the cache hits.
 */
class AnthropicProvider(private val config: AiConfig) : AiProvider {
    private val client: AnthropicClient = AnthropicOkHttpClient.builder()
        .apiKey(config.apiKey)
        .apply { if (config.baseUrl.isNotBlank()) baseUrl(config.baseUrl) }
        .build()

    override val model: String get() = config.model

    override val historyKey: String get() = "anthropic|${config.baseUrl}|${config.model}"

    override fun conversation(system: String, tools: List<McpTools.Tool>): AiConversation = Chat(system, tools.map(::declare), mutableListOf())

    override fun resume(system: String, tools: List<McpTools.Tool>, history: String): AiConversation? {
        val messages = runCatching { jsonMapper().readValue(history, object : TypeReference<List<MessageParam>>() {}) }.getOrNull() ?: return null
        // Stopped between a message sent and its answer: that message goes again with the next one.
        val kept = messages.dropLastWhile { it.role() == MessageParam.Role.USER }
        return Chat(system, tools.map(::declare), kept.toMutableList())
    }

    private inner class Chat(
        private val system: String,
        private val declared: List<Tool>,
        private val history: MutableList<MessageParam>,
    ) : AiConversation {
        /** Tool calls of the last answer that no result followed: the turn stopped (a restart, an error) before it sent them. */
        private var unanswered: List<String> = history.lastOrNull()?.takeIf { it.role() == MessageParam.Role.ASSISTANT }
            ?.content()?.blockParams()?.orElse(null).orEmpty().mapNotNull { block -> block.toolUse().map { it.id() }.orElse(null) }

        @Synchronized
        override fun history(): String = jsonMapper().writeValueAsString(history)

        @Synchronized
        override fun step(input: List<AiInput>): AiReply {
            val answered = input.filterIsInstance<AiInput.ToolResult>().map { it.callId }.toSet()
            val interrupted = unanswered.filter { it !in answered }
                .map { AiInput.ToolResult(it, """{"error":"interrupted","message":"The turn stopped before this result was sent; check what the call did before doing it again."}""", true) }
            history += MessageParam.builder().role(MessageParam.Role.USER).contentOfBlockParams((interrupted + input).map(::block)).build()
            val params = MessageCreateParams.builder()
                .model(config.model)
                .maxTokens(MAX_TOKENS)
                .system(system)
                .tools(declared.map { com.anthropic.models.messages.ToolUnion.ofTool(it) })
                .messages(history.toList())
                // Caches tools + system + history up to the last message: each step rereads them.
                .cacheControl(CacheControlEphemeral.builder().build())
                .outputConfig(OutputConfig.builder().effort(OutputConfig.Effort.of(config.effort)).build())
                .apply {
                    // A refusal by a safety classifier is retried on another model the API picks.
                    if (config.model in FALLBACK_MODELS && config.baseUrl.isBlank()) {
                        putAdditionalHeader("anthropic-beta", FALLBACK_BETA)
                        putAdditionalBodyProperty("fallbacks", JsonValue.from("default"))
                    }
                }
                .build()
            val response = try {
                client.messages().create(params)
            } catch (e: Exception) {
                // The message stays out of the history: the next one is sent after the last answer.
                history.removeAt(history.lastIndex)
                throw failure(e)
            }
            history += response.toParam()
            val texts = response.content().mapNotNull { block -> block.text().map { it.text() }.orElse(null) }.filter { it.isNotBlank() }
            val calls = response.content().mapNotNull { block ->
                block.toolUse().map { AiToolCall(it.id(), it.name(), toJson(it._input())) }.orElse(null)
            }
            unanswered = calls.map { it.id }
            val stop = when (response.stopReason().orElse(null)) {
                StopReason.TOOL_USE -> AiReply.TOOLS
                StopReason.MAX_TOKENS -> AiReply.LIMIT
                StopReason.REFUSAL -> AiReply.REFUSED
                else -> if (calls.isNotEmpty()) AiReply.TOOLS else AiReply.END
            }
            val usage = response.usage()
            return AiReply(texts, calls, stop, usage.inputTokens(), usage.outputTokens())
        }
    }

    private fun failure(e: Exception): Exception = when (e) {
        is UnauthorizedException -> AiFailure("ai_key_refused", "Anthropic refused the API key", e)
        is PermissionDeniedException -> AiFailure("ai_key_refused", "Anthropic refused the API key: ${e.message}", e)
        is RateLimitException -> AiFailure("ai_rate_limited", "Anthropic rate limit: ${e.message}", e)
        is AnthropicServiceException -> AiFailure("ai_provider_error", "Anthropic answered ${e.statusCode()}: ${e.message}", e)
        is AnthropicIoException -> AiFailure("ai_unreachable", "Anthropic could not be reached: ${e.message}", e)
        else -> e
    }

    private fun block(input: AiInput): ContentBlockParam = when (input) {
        is AiInput.Text -> ContentBlockParam.ofText(TextBlockParam.builder().text(input.text).build())
        is AiInput.ToolResult -> ContentBlockParam.ofToolResult(
            ToolResultBlockParam.builder().toolUseId(input.callId).content(input.json).isError(input.error).build(),
        )
    }

    private fun declare(tool: McpTools.Tool): Tool {
        val schema = Tool.InputSchema.builder()
        @Suppress("UNCHECKED_CAST")
        val properties = tool.input["properties"] as? Map<String, Any?> ?: emptyMap()
        schema.properties(Tool.InputSchema.Properties.builder().apply {
            properties.forEach { (name, spec) -> putAdditionalProperty(name, JsonValue.from(spec)) }
        }.build())
        (tool.input["required"] as? List<*>)?.let { required -> schema.required(required.map(Any?::toString)) }
        schema.putAdditionalProperty("additionalProperties", JsonValue.from(false))
        return Tool.builder().name(tool.name).description(tool.description).inputSchema(schema.build()).build()
    }

    private fun toJson(value: JsonValue): JsonNode = Call.mapper.readTree(Call.mapper.writeValueAsString(value))

    private companion object {
        const val MAX_TOKENS = 16_000L
        const val FALLBACK_BETA = "server-side-fallback-2026-07-01"
        val FALLBACK_MODELS = setOf("claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")
    }
}
