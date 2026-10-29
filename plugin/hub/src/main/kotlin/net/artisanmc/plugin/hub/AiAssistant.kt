package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.logging.Level
import java.util.logging.Logger

/**
 * The editor's assistant (ADR `editor-assistant`): a conversation with the admin's model, which
 * acts through the MCP endpoint's own tools ([McpTools]) as the signed-in player, less publish
 * and config. It writes drafts; the player deploys. The hub runs the loop, so the key never
 * leaves it; the editor posts a message and reads the [Event]s as they come.
 *
 * Conversations live in memory: a restart ends them (the drafts they wrote stay).
 */
class AiAssistant(
    private val provider: AiProvider,
    private val tools: McpTools,
    private val maxSteps: Int = 25,
    private val logger: Logger? = null,
    private val clock: Clock = Clock.systemUTC(),
    /** The loop blocks on the model and on servers: never on the web server's threads. */
    private val executor: ExecutorService = Executors.newFixedThreadPool(4) { r -> Thread(r, "artisan-ai").apply { isDaemon = true } },
) {
    /** What the editor shows, in order: [seq] from 0, so it asks only for what it has not seen. */
    data class Event(val seq: Int, val type: String, val data: Map<String, Any?>)

    inner class Conversation(val id: String, val owner: UUID, val project: String?) {
        val createdAt: Instant = clock.instant()
        @Volatile var lastActive: Instant = createdAt
        @Volatile var running = false
        @Volatile var inputTokens = 0L
        @Volatile var outputTokens = 0L
        private val events = mutableListOf<Event>()
        internal val model = provider.conversation(system(project), tools.tools)

        @Synchronized fun add(type: String, vararg data: Pair<String, Any?>) {
            events += Event(events.size, type, data.toMap().filterValues { it != null })
        }

        @Synchronized fun after(seq: Int): List<Event> = events.drop(seq.coerceAtLeast(0))

        /** The first thing the player asked: the conversation's name in the list. */
        @Synchronized fun title(): String? = events.firstOrNull { it.type == USER }?.data?.get("text")?.toString()?.take(80)
    }

    sealed interface Sent {
        data object Accepted : Sent
        data object Busy : Sent
        data object NotFound : Sent
    }

    private val conversations = ConcurrentHashMap<String, Conversation>()

    val model: String get() = provider.model

    fun start(session: EditorSession, project: String?): Conversation {
        expire()
        val own = conversations.values.filter { it.owner == session.playerId }.sortedBy { it.lastActive }
        own.dropLast(MAX_PER_PLAYER - 1).forEach { conversations.remove(it.id) }
        return Conversation(UUID.randomUUID().toString(), session.playerId, project).also { conversations[it.id] = it }
    }

    fun get(session: EditorSession, id: String): Conversation? {
        expire()
        return conversations[id]?.takeIf { it.owner == session.playerId }
    }

    fun list(session: EditorSession): List<Conversation> {
        expire()
        return conversations.values.filter { it.owner == session.playerId }.sortedByDescending { it.lastActive }
    }

    fun delete(session: EditorSession, id: String): Boolean =
        get(session, id)?.takeIf { !it.running }?.let { conversations.remove(it.id) != null } ?: false

    /** Starts answering [text] on another thread; the answer arrives as events. */
    fun send(session: EditorSession, id: String, text: String): Sent {
        val conversation = get(session, id) ?: return Sent.NotFound
        synchronized(conversation) {
            if (conversation.running) return Sent.Busy
            conversation.running = true
            conversation.lastActive = clock.instant()
            conversation.add(USER, "text" to text)
        }
        // Read when the player writes, like a session: losing `edit` stops the next message.
        val principal = McpPrincipal(session.playerId, session.playerName, session.permissions - EditorPermissions.PUBLISH - EditorPermissions.CONFIG, clientName = CLIENT)
        executor.execute { run(conversation, principal, text) }
        return Sent.Accepted
    }

    /** Replaced by another (its settings changed): a turn under way finishes, no new one starts. */
    fun close() = executor.shutdown()

    private fun run(conversation: Conversation, principal: McpPrincipal, text: String) {
        try {
            var input: List<AiInput> = listOf(AiInput.Text(text))
            for (step in 1..maxSteps) {
                val reply = conversation.model.step(input)
                conversation.inputTokens += reply.inputTokens
                conversation.outputTokens += reply.outputTokens
                reply.texts.forEach { conversation.add(TEXT, "text" to it) }
                when (reply.stop) {
                    AiReply.LIMIT -> return conversation.add(NOTICE, "code" to "ai_output_limit")
                    AiReply.REFUSED -> return conversation.add(NOTICE, "code" to "ai_refused")
                }
                if (reply.toolCalls.isEmpty()) return
                input = reply.toolCalls.map { call(conversation, principal, it) }
            }
            conversation.add(NOTICE, "code" to "ai_step_limit", "steps" to maxSteps)
        } catch (e: AiFailure) {
            logger?.warning("[Artisan] Assistant for ${principal.playerName}: ${e.message}")
            conversation.add(ERROR, "code" to e.code)
        } catch (e: Exception) {
            logger?.log(Level.WARNING, "[Artisan] Assistant for ${principal.playerName} failed", e)
            conversation.add(ERROR, "code" to "ai_error")
        } finally {
            conversation.lastActive = clock.instant()
            conversation.add(DONE, "inputTokens" to conversation.inputTokens, "outputTokens" to conversation.outputTokens)
            conversation.running = false
        }
    }

    /** Runs one tool call, records it for the editor, and returns its result for the model. */
    private fun call(conversation: Conversation, principal: McpPrincipal, call: AiToolCall): AiInput.ToolResult {
        val tool = tools.find(call.name)
        val outcome = if (tool == null) McpTools.Outcome(mapOf("error" to "unknown_tool", "message" to "No tool '${call.name}'."), error = true)
        else {
            if (!tool.readOnly) logger?.info("[Artisan] Assistant for ${principal.playerName}: ${call.name} ${call.input.path("path").asText("")}".trimEnd())
            tools.invoke(principal, tool, call.input)
        }
        val body = outcome.body as? Map<*, *>
        conversation.add(
            TOOL,
            "name" to call.name,
            "project" to call.input.text("project"),
            "path" to call.input.text("path"),
            "ok" to !outcome.error,
            "error" to body?.get("error")?.takeIf { outcome.error },
            "problems" to (body?.get("problems") as? List<*>)?.size?.takeIf { outcome.error },
            "draft" to draftOf(call, body, outcome.error),
        )
        return AiInput.ToolResult(call.id, McpTools.resultText(outcome.body, indent = false), outcome.error)
    }

    /** The draft a call made or wrote into, so the editor can offer to open it. */
    private fun draftOf(call: AiToolCall, body: Map<*, *>?, error: Boolean): Map<String, Any?>? {
        if (error || body == null) return null
        val draftId = body["draft_id"]?.toString() ?: return null
        if (call.name != "start_draft" && call.name != "write_document") return null
        return mapOf("project" to (body["project"] ?: call.input.text("project")), "id" to draftId, "name" to body["name"])
    }

    private fun JsonNode.text(field: String): String? = get(field)?.takeIf { it.isTextual }?.asText()

    private fun expire() {
        val limit = clock.instant().minus(IDLE)
        conversations.values.removeIf { !it.running && it.lastActive.isBefore(limit) }
    }

    private fun system(project: String?): String = buildString {
        append(McpRoutes.INSTRUCTIONS)
        append("\n\nYou are the assistant inside the Artisan editor, talking with the player who has it open. ")
        append("Answer in the player's language. Keep answers short: what you did, what to check, and the draft's name. ")
        append("When you have written a draft, tell the player to open Drafts (next to Deploy), review the changes, and deploy. ")
        append("Ask before large changes the player did not describe.")
        if (project != null) append("\n\nThe player has this Project open: $project. Work in it unless asked otherwise.")
    }

    companion object {
        const val USER = "user"
        const val TEXT = "text"
        const val TOOL = "tool"
        const val NOTICE = "notice"
        const val ERROR = "error"
        const val DONE = "done"
        const val CLIENT = "assistant"
        const val MAX_PER_PLAYER = 10
        val IDLE: Duration = Duration.ofHours(6)
    }
}
