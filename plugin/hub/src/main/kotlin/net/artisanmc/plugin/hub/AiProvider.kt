package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode

/**
 * The `ai` section of environment.yml (ADR `editor-assistant`): the model the editor's assistant
 * talks to, on the admin's own key. Read by the hub only, never sent to the editor.
 */
data class AiConfig(
    /**
     * `anthropic`, `openai` (any OpenAI-compatible API, at [baseUrl]) or `artisan` (the models of
     * artisanmc.net, paid from the linked site account's credits: no key); empty: no assistant.
     */
    val provider: String = "",
    val apiKey: String = "",
    val model: String = DEFAULT_MODEL,
    /** `low` … `max`; how hard the model thinks, and how many tokens it spends. Anthropic only. */
    val effort: String = "medium",
    /** Model calls one message may make before the assistant stops and says so. */
    val maxSteps: Int = 25,
    /** Another address for the provider's API (a proxy); empty: its own. */
    val baseUrl: String = "",
) {
    val enabled: Boolean get() = provider == ARTISAN || (provider.isNotBlank() && apiKey.isNotBlank())

    companion object {
        const val DEFAULT_MODEL = "claude-opus-5-5"
        /** The site's models, through the network's link to its account ([CloudProvider]). */
        const val ARTISAN = "artisan"
        val PROVIDERS = setOf("anthropic", "openai", ARTISAN)
    }
}

/**
 * Where a provider sends its calls instead of the vendor's API: artisanmc.net's relay, which
 * calls the vendor with its own key and takes the cost from the linked account ([CloudProvider]).
 */
class AiRelay(
    val endpoint: String,
    /** The site link's token, read at each call; null: the network is not linked. */
    val token: () -> String?,
    /** The site refused the token (unlinked there). */
    val refused: () -> Unit = {},
) {
    fun key(): String = token() ?: throw AiFailure("ai_not_linked", "The network is not linked to an artisanmc.net account")

    /** What the relay itself refuses, before or instead of the vendor's answer; null: the vendor's own failure. */
    fun failure(status: Int, message: String): AiFailure? = when (status) {
        401 -> {
            runCatching(refused)
            AiFailure("ai_not_linked", "artisanmc.net refused the link: $message")
        }
        402 -> AiFailure("ai_no_credits", "The linked account has no AI credits left")
        404 -> AiFailure("ai_cloud_model", "artisanmc.net does not offer this model: $message")
        else -> null
    }
}

/** A model service. Each provider keeps a conversation's history in its own wire types. */
interface AiProvider {
    val model: String

    /** What a stored history is valid for: another provider, address or model cannot take it back. */
    val historyKey: String get() = model

    /** The kinds of files it reads; another one is refused before it is sent. */
    val attachments: Set<AiAttachment.Kind> get() = AiAttachment.Kind.entries.toSet()

    fun conversation(system: String, tools: List<McpTools.Tool>): AiConversation

    /**
     * The conversation [history] (from [AiConversation.history]) left, to go on with. Null: this
     * provider cannot read it, and the conversation starts again from a transcript.
     */
    fun resume(system: String, tools: List<McpTools.Tool>, history: String): AiConversation? = null
}

/** One conversation with a model: the history stays inside, [step] adds to it. */
interface AiConversation {
    /** Sends [input] after the history and returns the model's answer, which joins the history too. */
    fun step(input: List<AiInput>): AiReply

    /**
     * [step], telling [live] the answer as it is written: its text, and each tool call with its
     * input as it grows. A provider that cannot stream answers at once (the default).
     */
    fun stream(input: List<AiInput>, live: (AiDelta) -> Unit): AiReply = step(input)

    /** The history as the provider keeps it, to store; null: it keeps none worth storing. */
    fun history(): String? = null
}

sealed interface AiInput {
    data class Text(val text: String) : AiInput
    data class ToolResult(val callId: String, val json: String, val error: Boolean) : AiInput
    /** An image the player attached ([AiAttachment]), in base64. */
    data class Image(val name: String, val mediaType: String, val base64: String) : AiInput
    /** A PDF the player attached, in base64. */
    data class Pdf(val name: String, val base64: String) : AiInput
}

/** A piece of an answer being written ([AiConversation.stream]). */
sealed interface AiDelta {
    /** More text; [block] counts the answer's text blocks from 0, so two blocks do not run together. */
    data class Text(val block: Int, val text: String) : AiDelta
    data class ToolStart(val id: String, val name: String) : AiDelta
    /** More of a tool call's input, as raw JSON that is not complete until the call ends. */
    data class ToolInput(val id: String, val json: String) : AiDelta
}

data class AiToolCall(val id: String, val name: String, val input: JsonNode)

data class AiReply(
    val texts: List<String>,
    val toolCalls: List<AiToolCall>,
    /** Why the model stopped, in the assistant's words: [END], [TOOLS], [LIMIT], [REFUSED]. */
    val stop: String,
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
) {
    companion object {
        const val END = "end"
        const val TOOLS = "tools"
        const val LIMIT = "limit"
        const val REFUSED = "refused"
    }
}

/** The provider failed (key refused, rate limit, network): [code] for the editor, [message] for the log. */
class AiFailure(val code: String, message: String, cause: Throwable? = null) : RuntimeException(message, cause)
