package net.artisanmc.plugin.importing

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.protocol.EditorRequest
import net.artisanmc.plugin.protocol.Replies

/**
 * The editor's side of the imports (ADR `data-imports` §7): `imports_fetch` lists the sources,
 * the files, the runs in progress and the last ones; `import_start` checks a run, answers with
 * its batch, then runs it on [async]. The editor reads the result in the next `imports_fetch`:
 * a run is logged when it ends, whatever its end.
 */
class ImportRequests(
    private val replies: Replies,
    /** Null: imports are not wired on this server. */
    private val runs: () -> ImportRuns?,
    /** Runs a blocking task off the game threads and off the reply threads. */
    private val async: (() -> Unit) -> Unit,
) {
    private val mapper = ObjectMapper()

    fun fetch(request: EditorRequest.ImportsFetch) {
        val reply = replies.to(request, "imports_result")
        val runs = runs() ?: return reply.error("imports_unavailable")
        // The history is a database read: never on the thread the request came on.
        launch(reply, "imports listing") {
            reply.ok(
                "sources" to runs.sources().map { s ->
                    mapOf(
                        "id" to s.id(), "label" to s.label(), "module" to s.module(), "reads_file" to s.readsFile(),
                        "conflicts" to s.conflicts(), "conflict_running" to runs.conflict(s),
                    )
                },
                "files" to runs.files(),
                "active" to runs.active().map {
                    mapOf("batch" to it.batch, "source" to it.source, "module" to it.module, "action" to it.action, "started_at" to it.startedAt, "target" to it.target)
                },
                "runs" to runs.history(HISTORY).map {
                    mapOf(
                        "batch" to it.batch, "source" to it.source, "module" to it.module, "action" to it.action, "applied" to it.applied,
                        "actor" to it.actor, "at" to it.at, "target" to it.target, "report" to report(it.reportJson),
                    )
                },
            )
        }
    }

    fun start(request: EditorRequest.ImportStart) {
        val reply = replies.to(request, "import_started")
        val runs = runs() ?: return reply.error("imports_unavailable")
        launch(reply, "import start") {
            val start = when (request.action) {
                "run" -> runs.prepare(request.source ?: return@launch reply.error("invalid_input", "source"), request.file?.takeIf { it.isNotBlank() }, request.confirm, request.actor, request.lang)
                "rollback" -> runs.prepareRollback(request.batch ?: return@launch reply.error("invalid_input", "batch"), request.confirm, request.actor)
                else -> return@launch reply.error("invalid_input", "action")
            }
            when (start) {
                is Start.Refused -> reply.error(start.refusal.code, start.refusal.args.values.firstOrNull())
                is Start.Ready -> {
                    reply.ok("batch" to start.batch)
                    // Already off the game threads: the run goes on here, its end is in the log.
                    start.run()
                }
            }
        }
    }

    private fun launch(reply: Replies.Reply, context: String, task: () -> Unit) {
        try {
            async {
                try {
                    task()
                } catch (e: Throwable) {
                    if (e is VirtualMachineError) throw e
                    reply.failure("import_failed", context, e)
                }
            }
        } catch (e: Throwable) {
            reply.failure("import_failed", "$context scheduling", e)
        }
    }

    private fun report(json: String): Any? = try {
        mapper.readValue(json, Map::class.java)
    } catch (_: Exception) {
        null
    }

    private companion object {
        const val HISTORY = 30
    }
}
