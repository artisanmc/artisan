package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.time.Duration
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * The server as seen by the hub: an editor protocol message (`project_read`, `project_write`…)
 * and its reply (`project_read_result`…). The future fails with `TimeoutException` without a reply.
 */
fun interface ServerLink {
    fun request(message: Map<String, Any?>): CompletableFuture<Map<String, Any?>>
}

/**
 * Hub and server in the same process: the message goes to the same handlers as the
 * WebSocket's, and the reply comes back through [deliver] instead of the network.
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

    /** True if [payload] answers a request of this link: it must then go nowhere else. */
    fun deliver(payload: Map<String, Any?>): Boolean {
        val id = payload["request_id"] as? String ?: return false
        return pending[id]?.complete(payload) != null
    }
}
