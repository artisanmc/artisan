package net.artisanmc.plugin.protocol

import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import java.util.logging.Level
import java.util.logging.Logger

/**
 * Replies to the editor. Sending always goes through [io]: never on the WebSocket
 * callback thread, never on a world thread. A closed executor (plugin shutting
 * down) drops the reply with a warning, without throwing.
 */
class Replies(
    private val io: Executor,
    private val transport: (Map<String, Any?>) -> Unit,
    private val logger: Logger?,
) {
    fun to(request: EditorRequest.WithReply, resultType: String) = Reply(resultType, request.requestId)

    /** Runs [task] off the WebSocket callback, on [executor]. */
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

        /** Logs [cause] with its stack trace, then replies [code] with a readable message. */
        fun failure(code: String, context: String, cause: Throwable) {
            logger?.log(Level.WARNING, "[Artisan] $context failed", cause)
            error(code, describe(cause))
        }
    }

    companion object {
        /** Never "?" in the editor: without a message, the exception type. */
        fun describe(cause: Throwable): String = cause.message?.takeIf { it.isNotBlank() } ?: cause.javaClass.simpleName
    }
}
