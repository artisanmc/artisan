package net.artisanmc.plugin.protocol

import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import java.util.logging.Level
import java.util.logging.Logger

/**
 * Répond à l'éditeur. L'envoi passe toujours par [io] : jamais sur le thread du
 * callback WebSocket, jamais sur un thread du monde. Un exécuteur fermé (plugin
 * en cours d'arrêt) perd la réponse avec un avertissement, sans lever.
 */
class Replies(
    private val io: Executor,
    private val transport: (Map<String, Any?>) -> Unit,
    private val logger: Logger?,
) {
    fun to(request: EditorRequest.WithReply, resultType: String) = Reply(resultType, request.requestId)

    /** Exécute [task] hors du callback WebSocket, sur [executor]. */
    fun offThread(name: String, executor: Executor = io, task: () -> Unit) {
        try {
            executor.execute(task)
        } catch (_: RejectedExecutionException) {
            logger?.warning("$name dropped — plugin is stopping")
        }
    }

    inner class Reply(private val type: String, private val requestId: String) {
        fun send(payload: Map<String, Any?>) = offThread(type) {
            transport(mapOf("type" to type, "request_id" to requestId) + payload)
        }

        fun ok(vararg fields: Pair<String, Any?>) = send(mapOf("ok" to true) + fields)

        fun error(code: String, message: String? = null) =
            send(if (message == null) mapOf("ok" to false, "error" to code) else mapOf("ok" to false, "error" to code, "message" to message))

        /** Journalise [error] avec sa pile, puis répond [code] avec un message lisible. */
        fun failure(code: String, context: String, cause: Throwable) {
            logger?.log(Level.WARNING, "[Artisan] $context failed", cause)
            error(code, describe(cause))
        }
    }

    companion object {
        /** Jamais « ? » côté éditeur : à défaut de message, le type de l'exception. */
        fun describe(cause: Throwable): String = cause.message?.takeIf { it.isNotBlank() } ?: cause.javaClass.simpleName
    }
}
