package net.artisanmc.plugin.hub

import java.util.concurrent.CompletionException
import java.util.concurrent.TimeoutException
import java.util.logging.Level
import java.util.logging.Logger

/** Une requête du protocole, puis une réponse HTTP construite depuis sa réponse. */
class Relay(private val logger: Logger?) {
    fun send(call: Call, server: EditorServer, message: Map<String, Any?>, respond: (Map<String, Any?>) -> Unit) {
        if (server.updateRequired) return call.error(503, "plugin_update_required")
        server.link.request(message).whenComplete { reply, failure ->
            try {
                val cause = (failure as? CompletionException)?.cause ?: failure
                when {
                    cause is TimeoutException -> call.error(504, "fetch_timeout")
                    cause is ServerOfflineException -> call.error(503, "server_offline")
                    cause != null -> {
                        logger?.log(Level.WARNING, "[Artisan] ${message["type"]} failed", cause)
                        call.error(502, "fetch_error", cause.message)
                    }
                    else -> respond(reply)
                }
            } catch (e: Exception) {
                logger?.log(Level.WARNING, "[Artisan] ${message["type"]} reply failed", e)
                call.error(500, "internal_error")
            }
        }
    }

    companion object {
        /** La réponse sans son enveloppe de protocole. */
        fun body(reply: Map<String, Any?>): Map<String, Any?> = reply - setOf("type", "request_id", "ok")

        fun ok(reply: Map<String, Any?>) = reply["ok"] == true

        fun errorCode(reply: Map<String, Any?>) = reply["error"] as? String ?: "fetch_error"

        /** Mêmes statuts que le backend pour une lecture de Project refusée. */
        fun readError(call: Call, reply: Map<String, Any?>) {
            val code = errorCode(reply)
            val status = when (code) {
                "unknown_project", "not_found" -> 404
                "invalid_path" -> 422
                "plugin_update_required", "write_error", "storage_error" -> 503
                else -> 502
            }
            call.json(mapOf("error" to code, "message" to reply["message"]), status)
        }
    }
}
