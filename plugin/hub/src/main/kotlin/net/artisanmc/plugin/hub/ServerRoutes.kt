package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.AccountRoutes.Companion.LOCAL
import net.artisanmc.plugin.hub.EditorPermissions.CONFIG
import net.artisanmc.plugin.hub.EditorPermissions.PUBLISH
import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import net.artisanmc.plugin.hub.Relay.Companion.body
import net.artisanmc.plugin.hub.Relay.Companion.errorCode
import net.artisanmc.plugin.hub.Relay.Companion.ok

/** `/api/v1/networks/local/servers/local/…` : ce que le serveur déclare, sa configuration, ses données live. */
class ServerRoutes(private val server: LocalServer, private val relay: Relay) {
    fun register(router: Router) {
        on(router, "GET", "modules", VIEW) { it.json(mapOf("modules" to server.modules())) }
        on(router, "GET", "data-sources", VIEW) { it.json(mapOf("data_sources" to server.dataSources())) }
        on(router, "GET", "models", VIEW) { call ->
            val models = server.models().filter { (it["id"] as? String)?.contains(':') == true }.sortedBy { it["id"] as String }
            call.json(mapOf("models" to models))
        }
        on(router, "GET", "screens", VIEW) { it.json(mapOf("screens" to server.screens())) }
        on(router, "GET", "editor-access", VIEW) { it.json(EDITOR_ACCESS) }

        on(router, "GET", "server-config", VIEW) { it.json(mapOf("config" to server.serverConfig(), "online" to true)) }
        on(router, "PATCH", "server-config", CONFIG) { call ->
            val changes = call.body()?.get("changes")?.takeIf { it.isObject && it.size() > 0 }
                ?: return@on call.error(422, "invalid_input")
            relay.send(call, mapOf("type" to "server_config_write", "changes" to changes)) { reply ->
                if (ok(reply)) call.json(mapOf("config" to reply["server_config"]))
                else call.json(mapOf("error" to errorCode(reply), "message" to reply["message"]), 422)
            }
        }

        // Écrans de config des modules : lecture et écriture directes sur le disque, comme une publication.
        on(router, "POST", "config/read", VIEW) { call ->
            val request = call.body()
            val project = request?.get("project_id")?.takeIf { it.isTextual && it.asText().isNotEmpty() }
            val table = request?.get("table")?.takeIf { it.isTextual && it.asText().isNotEmpty() }
            if (project == null || table == null) return@on call.error(422, "invalid_input")
            relay.send(call, mapOf("type" to "config_read", "project_id" to project.asText(), "table" to table.asText())) { reply ->
                if (ok(reply)) call.json(mapOf("files" to (reply["files"] ?: emptyList<Any>())))
                else configError(call, reply, "read_error")
            }
        }
        on(router, "POST", "config/write", PUBLISH) { call ->
            val request = call.body()
            val project = request?.get("project_id")?.takeIf { it.isTextual && it.asText().isNotEmpty() }
            val files = request?.get("files")?.takeIf { it.isArray }
                ?.filter { it.path("path").isTextual && it.path("content").isTextual }
            val deletes = request?.get("deletes")?.filter { it.isTextual }.orEmpty()
            if (project == null || files == null || files.isEmpty() && deletes.isEmpty()) return@on call.error(422, "invalid_input")
            val message = mapOf("type" to "config_write", "project_id" to project.asText(), "files" to files, "deletes" to deletes)
            relay.send(call, message) { reply ->
                if (ok(reply)) call.json(mapOf("ok" to true))
                else configError(call, reply, "write_error")
            }
        }

        on(router, "GET", "players", VIEW) { call ->
            server.link.request(mapOf("type" to "online_players_fetch")).whenComplete { reply, _ ->
                call.json(mapOf("players" to (reply?.takeIf(::ok)?.get("players") ?: emptyList<String>())))
            }
        }
        on(router, "GET", "papi-placeholders", VIEW) { call ->
            relay.send(call, mapOf("type" to "papi_placeholders_fetch")) { reply ->
                if (ok(reply)) call.json(mapOf("placeholders" to reply["placeholders"], "truncated" to reply["truncated"]))
                else call.error(502, "fetch_error")
            }
        }
        on(router, "GET", "head-texture", VIEW) { call ->
            val id = call.query("id")?.takeIf { HDB_ID.matches(it) } ?: return@on call.error(422, "invalid_input")
            relay.send(call, mapOf("type" to "head_texture_fetch", "id" to id)) { reply ->
                when {
                    ok(reply) -> call.json(mapOf("texture" to reply["texture"]))
                    errorCode(reply) == "head_not_found" -> call.error(404, "head_not_found")
                    else -> call.error(502, errorCode(reply))
                }
            }
        }
        on(router, "GET", "player-inventory", VIEW) { call ->
            val player = call.query("player")?.takeIf { it.isNotBlank() } ?: return@on call.error(422, "invalid_input")
            relay.send(call, mapOf("type" to "player_inventory_fetch", "player" to player)) { reply ->
                when {
                    ok(reply) -> call.json(mapOf("slots" to reply["slots"]))
                    errorCode(reply) == "player_not_found" -> call.error(404, "player_not_found", reply["message"] as? String)
                    else -> call.error(502, errorCode(reply), reply["message"] as? String)
                }
            }
        }
        on(router, "POST", "data-sources/preview", VIEW) { call ->
            val request = call.body()
            val ref = request?.get("ref")?.takeIf { it.isTextual }?.asText() ?: return@on call.error(422, "invalid_input")
            val message = mapOf(
                "type" to "data_source_fetch",
                "ref" to ref,
                "params" to (request["params"] ?: emptyMap<String, Any>()),
                "filter" to (request["filter"] ?: emptyMap<String, Any>()),
                "sort" to request["sort"],
                "limit" to request["limit"],
                "args" to (request["args"] ?: emptyMap<String, Any>()),
            )
            relay.send(call, message) { reply ->
                if (ok(reply)) return@send call.json(body(reply))
                val status = when (errorCode(reply)) {
                    "unknown_source" -> 404
                    "player_required" -> 422
                    else -> 502
                }
                call.json(mapOf("error" to errorCode(reply), "message" to reply["message"]), status)
            }
        }
    }

    private fun configError(call: Call, reply: Map<String, Any?>, fallback: String) {
        val code = reply["error"] as? String ?: fallback
        val status = when (code) {
            "unknown_project" -> 404
            "invalid_path" -> 422
            else -> 502
        }
        call.json(mapOf("error" to code, "message" to reply["message"]), status)
    }

    private fun on(router: Router, method: String, suffix: String, permission: String, handler: (Call) -> Unit) {
        router.on(method, "$SERVER/$suffix", permission) { call ->
            if (call.params["network"] != LOCAL || call.params["server"] != LOCAL) call.error(404, "not_found")
            else handler(call)
        }
    }

    companion object {
        const val SERVER = "/api/v1/networks/:network/servers/:server"
        private val HDB_ID = Regex("[0-9]{1,10}")

        /** Sans facturation ni quota : l'accès est toujours ouvert. */
        val EDITOR_ACCESS = mapOf(
            "enabled" to true, "quota" to null, "proUntil" to null,
            "inventoryAvailable" to true, "count" to null, "reason" to null,
        )
    }
}
