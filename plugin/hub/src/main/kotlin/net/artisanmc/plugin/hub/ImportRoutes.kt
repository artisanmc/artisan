package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.CONFIG
import net.artisanmc.plugin.hub.Relay.Companion.ok
import net.artisanmc.plugin.hub.Relay.Companion.readError
import net.artisanmc.plugin.protocol.ProtocolVersion
import java.util.logging.Logger

/**
 * `/api/v1/servers/:server/imports…` (ADR `data-imports` §7), behind `artisan.editor.config`: the
 * import sources a server's modules registered, their runs, and the two ways to start one. A run
 * happens on the server that holds the data; the hub only relays. `POST` answers 202 with the
 * run's batch before the run ends: the editor reads its report in the next `GET`.
 */
class ImportRoutes(private val servers: Servers, private val relay: Relay, private val logger: Logger?) {
    fun register(router: Router) {
        router.on("GET", "$SERVER/imports", CONFIG) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            if (!speaksImports(call, server)) return@on
            relay.send(call, server, mapOf("type" to "imports_fetch")) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
                call.json(
                    mapOf(
                        "sources" to maps(reply["sources"]).map { s ->
                            mapOf(
                                "id" to s["id"], "label" to s["label"], "module" to s["module"], "readsFile" to (s["reads_file"] == true),
                                "conflicts" to (s["conflicts"] ?: emptyList<String>()), "conflictRunning" to s["conflict_running"],
                            )
                        },
                        "files" to (reply["files"] ?: emptyList<String>()),
                        "active" to maps(reply["active"]).map { a ->
                            mapOf("batch" to a["batch"], "source" to a["source"], "module" to a["module"], "action" to a["action"], "startedAt" to a["started_at"], "target" to a["target"])
                        },
                        "runs" to maps(reply["runs"]).map { r ->
                            mapOf(
                                "batch" to r["batch"], "source" to r["source"], "module" to r["module"], "action" to r["action"],
                                "applied" to (r["applied"] == true), "actor" to r["actor"], "at" to r["at"], "target" to r["target"],
                                "report" to (r["report"] as? Map<*, *>)?.let(::report),
                            )
                        },
                    ),
                )
            }
        }
        router.on("POST", "$SERVER/imports/run", CONFIG) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            val body = call.body() ?: return@on call.error(422, "invalid_input")
            val source = body.path("source").asText("").takeIf { SOURCE.matches(it) } ?: return@on call.error(422, "invalid_input", "source")
            val file = body.path("file").asText("").ifEmpty { null }
            if (file != null && !FILE.matches(file)) return@on call.error(422, "bad_file", file)
            val confirm = body.path("confirm").asBoolean(false)
            start(call, server, listOfNotNull("action" to "run", "source" to source, file?.let { "file" to it }, "confirm" to confirm, "lang" to lang(body.path("lang").asText(""))).toMap(),
                "${if (confirm) "an import" else "a dry run"} from $source")
        }
        router.on("POST", "$SERVER/imports/rollback", CONFIG) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            val body = call.body() ?: return@on call.error(422, "invalid_input")
            val batch = body.path("batch").asText("").takeIf { BATCH.matches(it) } ?: return@on call.error(422, "invalid_input", "batch")
            val confirm = body.path("confirm").asBoolean(false)
            start(call, server, mapOf("action" to "rollback", "batch" to batch, "confirm" to confirm, "lang" to lang(body.path("lang").asText(""))),
                "${if (confirm) "the rollback" else "a dry-run rollback"} of batch $batch")
        }
    }

    private fun start(call: Call, server: EditorServer, message: Map<String, Any?>, what: String) {
        if (!speaksImports(call, server)) return
        val actor = call.session?.playerName ?: "editor"
        relay.send(call, server, mapOf("type" to "import_start", "actor" to actor) + message) { reply ->
            if (!ok(reply)) return@send readError(call, reply)
            logger?.info("[Artisan] $actor asked ${server.label} for $what")
            call.json(mapOf("batch" to reply["batch"]), 202)
        }
    }

    /** A report as the server logged it; a run that threw only has `failed`. */
    private fun report(r: Map<*, *>): Map<String, Any?> = mapOf(
        "failed" to r["failed"],
        "dryRun" to (r["dry_run"] == true),
        "batch" to r["batch"],
        "counts" to (r["counts"] ?: emptyList<Any>()),
        "alreadyImported" to ((r["already_imported"] as? Number)?.toInt() ?: 0),
        "rejected" to maps(r["rejected"]).map { mapOf("sourceId" to it["source_id"], "code" to it["code"], "message" to it["message"]) },
        "blockers" to (r["blockers"] ?: emptyList<String>()),
        "notes" to (r["notes"] ?: emptyList<String>()),
    )

    private fun maps(value: Any?): List<Map<*, *>> = (value as? List<*>)?.filterIsInstance<Map<*, *>>().orEmpty()

    private fun lang(asked: String) = asked.takeIf { LANG.matches(it) } ?: "en"

    /** A server on an older release would ignore the message: say so instead of waiting for the timeout. */
    private fun speaksImports(call: Call, server: EditorServer): Boolean {
        if (ProtocolVersion.minor(server.protocolVersion) >= ProtocolVersion.IMPORTS) return true
        call.error(501, "plugin_update_required")
        return false
    }

    private companion object {
        const val SERVER = ServerRoutes.SERVER
        val SOURCE = Regex("[a-z][a-z0-9_]*:[a-z0-9][a-z0-9_-]*")
        val BATCH = Regex("[A-Za-z0-9_-]{1,32}")
        val FILE = Regex("[^/\\\\.][^/\\\\]{0,254}")
        val LANG = Regex("[a-z]{2}(-[A-Za-z]{2})?")
    }
}
