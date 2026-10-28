package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.EDIT
import net.artisanmc.plugin.hub.EditorPermissions.VIEW

/**
 * The editor's assistant (ADR `editor-assistant`). Same-origin, signed in, `edit` to talk to it.
 * Without an `ai` section in environment.yml, only [STATUS] answers, with `enabled: false`.
 */
class AiRoutes(private val assistant: AiAssistant?) {
    fun register(router: Router) {
        router.on("GET", STATUS, VIEW) { call ->
            call.json(mapOf("enabled" to (assistant != null), "model" to assistant?.model, "canUse" to (assistant != null && call.session!!.can(EDIT))))
        }
        val assistant = assistant ?: return
        router.on("GET", CONVERSATIONS, EDIT) { call ->
            call.json(mapOf("conversations" to assistant.list(call.session!!).map(::summary)))
        }
        router.on("POST", CONVERSATIONS, EDIT) { call ->
            val project = call.body()?.path("project")?.asText("")?.takeIf { it.isNotBlank() }?.take(200)
            call.json(summary(assistant.start(call.session!!, project)), 201)
        }
        router.on("GET", "$CONVERSATIONS/:conversation", EDIT) { call ->
            val conversation = assistant.get(call.session!!, call.params.getValue("conversation")) ?: return@on call.error(404, "not_found")
            val after = call.query("after")?.toIntOrNull() ?: 0
            call.json(summary(conversation) + ("events" to conversation.after(after).map { mapOf("seq" to it.seq, "type" to it.type) + it.data }))
        }
        router.on("POST", "$CONVERSATIONS/:conversation/messages", EDIT) { call ->
            val text = call.body()?.path("text")?.asText("")?.trim().orEmpty()
            if (text.isEmpty() || text.length > MAX_MESSAGE) return@on call.error(422, "invalid_input")
            when (assistant.send(call.session!!, call.params.getValue("conversation"), text)) {
                AiAssistant.Sent.Accepted -> call.json(mapOf("ok" to true), 202)
                AiAssistant.Sent.Busy -> call.error(409, "ai_busy")
                AiAssistant.Sent.NotFound -> call.error(404, "not_found")
            }
        }
        router.on("DELETE", "$CONVERSATIONS/:conversation", EDIT) { call ->
            if (assistant.delete(call.session!!, call.params.getValue("conversation"))) call.json(mapOf("ok" to true))
            else call.error(404, "not_found")
        }
    }

    private fun summary(c: AiAssistant.Conversation) = mapOf(
        "id" to c.id, "project" to c.project, "title" to c.title(), "running" to c.running,
        "createdAt" to c.createdAt.toString(), "lastActive" to c.lastActive.toString(),
        "inputTokens" to c.inputTokens, "outputTokens" to c.outputTokens,
    )

    companion object {
        const val STATUS = "/api/v1/ai"
        const val CONVERSATIONS = "/api/v1/ai/conversations"
        const val MAX_MESSAGE = 8000
    }
}
