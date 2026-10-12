package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.time.Duration
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Le serveur vu par le hub : un message du protocole éditeur (`project_read`, `project_write`…)
 * et sa réponse (`project_read_result`…). Le futur échoue en `TimeoutException` sans réponse.
 */
fun interface ServerLink {
    fun request(message: Map<String, Any?>): CompletableFuture<Map<String, Any?>>
}

/**
 * Le hub et le serveur dans le même process : le message passe aux mêmes gestionnaires que
 * ceux du WebSocket, et la réponse revient par [deliver] au lieu de partir sur le réseau.
 */
class LocalServerLink(
    private val dispatch: (JsonNode) -> Unit,
    private val timeout: Duration = Duration.ofSeconds(10),
) : ServerLink {
    private val mapper = ObjectMapper()
    private val pending = ConcurrentHashMap<String, CompletableFuture<Map<String, Any?>>>()

    override fun request(message: Map<String, Any?>): CompletableFuture<Map<String, Any?>> {
        val id = "local-${UUID.randomUUID()}"
        val reply = CompletableFuture<Map<String, Any?>>()
        pending[id] = reply
        reply.whenComplete { _, _ -> pending.remove(id) }
        try {
            dispatch(mapper.valueToTree(message + ("request_id" to id)))
        } catch (e: Exception) {
            reply.completeExceptionally(e)
        }
        return reply.orTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS)
    }

    /** Vrai si [payload] répond à une requête de ce lien : il ne doit alors partir nulle part ailleurs. */
    fun deliver(payload: Map<String, Any?>): Boolean {
        val id = payload["request_id"] as? String ?: return false
        return pending[id]?.complete(payload) != null
    }
}
