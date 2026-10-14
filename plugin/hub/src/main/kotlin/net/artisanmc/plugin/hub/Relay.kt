package net.artisanmc.plugin.hub

import java.util.concurrent.CompletionException
import java.util.concurrent.TimeoutException
import java.util.logging.Level
import java.util.logging.Logger

/** A protocol request, then an HTTP response built from its reply. */
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
        /** The reply without its protocol envelope. */
        fun body(reply: Map<String, Any?>): Map<String, Any?> = reply - setOf("type", "request_id", "ok")

        fun ok(reply: Map<String, Any?>) = reply["ok"] == true

        fun errorCode(reply: Map<String, Any?>) = reply["error"] as? String ?: "fetch_error"

        /** A refused reply as an HTTP response: its code, its message, the status [ErrorStatus] gives the code. */
        fun readError(call: Call, reply: Map<String, Any?>, fallback: String = "fetch_error") {
            val code = reply["error"] as? String ?: fallback
            call.json(mapOf("error" to code, "message" to reply["message"]), ErrorStatus.of(code))
        }
    }
}

/**
 * The one mapping from an error code to an HTTP status. The editor decides on the code, never on
 * the status alone: a 404 is `unknown_project` (no such Project here), `draft_not_found` (no such
 * draft) or `not_found` (no such route, file or player), and each means something else to it.
 */
object ErrorStatus {
    fun of(code: String): Int = when (code) {
        "not_found", "unknown_project", "draft_not_found", "head_not_found", "player_not_found", "unknown_source", "unknown_version" -> 404
        "unauthorized" -> 401
        "forbidden", "cross_origin", "owner_revoked" -> 403
        "too_large" -> 413
        "invalid_input", "invalid_path", "invalid_name", "invalid_draft", "invalid_blob", "invalid_action", "invalid_owner",
        "invalid_operation", "invalid_body", "invalid_config", "invalid_zip", "missing_blob", "player_required" -> 422
        "conflict", "draft_conflict", "draft_exists", "draft_closed", "project_exists", "destination_exists", "addon_immutable",
        "operation_mismatch", "operation_conflict", "operation_expired", "too_soon" -> 409
        "plugin_update_required", "write_error", "storage_error", "server_offline", "database_unavailable", "hdb_unavailable",
        "draft_migration_pending", "rename_in_progress", "rename_pending", "inventory_unavailable" -> 503
        "fetch_timeout" -> 504
        "internal_error" -> 500
        else -> 502
    }
}
