package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.CONFIG
import net.artisanmc.plugin.hub.EditorPermissions.PUBLISH
import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import net.artisanmc.plugin.hub.Relay.Companion.body
import net.artisanmc.plugin.hub.Relay.Companion.errorCode
import net.artisanmc.plugin.hub.Relay.Companion.ok
import net.artisanmc.plugin.hub.Relay.Companion.readError
import net.artisanmc.plugin.protocol.ProtocolVersion

/** `/api/v1/servers/:server/…`: what the server declares, its configuration, its live data. */
class ServerRoutes(private val servers: Servers, private val relay: Relay) {
    private val bundles = BundleCache()
    /** A module's brand files, keyed `<brand hash>/<file>`: small SVGs, a few per module. */
    private val brands = BundleCache(maxEntries = 64, maxBytes = 2L * 1024 * 1024)

    fun register(router: Router) {
        on(router, "GET", "modules", VIEW) { call, server -> call.json(mapOf("modules" to server.announcement().modules)) }
        on(router, "GET", "data-sources", VIEW) { call, server -> call.json(mapOf("data_sources" to server.announcement().dataSources)) }
        on(router, "GET", "models", VIEW) { call, server ->
            val models = server.announcement().models.filter { (it["id"] as? String)?.contains(':') == true }.sortedBy { it["id"] as String }
            call.json(mapOf("models" to models))
        }
        on(router, "GET", "screens", VIEW) { call, server -> call.json(mapOf("screens" to server.announcement().screens)) }
        on(router, "GET", "actions", VIEW) { call, server -> call.json(mapOf("actions" to server.announcement().actions)) }
        on(router, "GET", "document-kinds", VIEW) { call, server -> call.json(mapOf("document_kinds" to server.announcement().documentKinds)) }
        on(router, "GET", "game-events", VIEW) { call, server -> call.json(mapOf("game_events" to server.announcement().gameEvents)) }
        // The commands modules declare, with their default dressing: the editor's System section.
        on(router, "GET", "player-commands", VIEW) { call, server -> call.json(mapOf("player_commands" to server.announcement().playerCommands)) }

        on(router, "GET", "server-config", VIEW) { call, server -> call.json(mapOf("config" to server.serverConfig(), "online" to server.online)) }
        on(router, "PATCH", "server-config", CONFIG) { call, server ->
            val changes = call.body()?.get("changes")?.takeIf { it.isObject && it.size() > 0 }
                ?: return@on call.error(422, "invalid_input")
            relay.send(call, server, mapOf("type" to "server_config_write", "changes" to changes)) { reply ->
                if (ok(reply)) call.json(mapOf("config" to reply["server_config"]))
                else call.json(mapOf("error" to errorCode(reply), "message" to reply["message"]), 422)
            }
        }

        // Module config screens: direct disk read and write, like a publish.
        on(router, "POST", "config/read", VIEW) { call, server ->
            val request = call.body()
            val project = request?.get("project_id")?.takeIf { it.isTextual && it.asText().isNotEmpty() }
            val table = request?.get("table")?.takeIf { it.isTextual && it.asText().isNotEmpty() }
            if (project == null || table == null) return@on call.error(422, "invalid_input")
            relay.send(call, server, mapOf("type" to "config_read", "project_id" to folder(server, project.asText()), "table" to table.asText())) { reply ->
                if (ok(reply)) call.json(mapOf("files" to (reply["files"] ?: emptyList<Any>())))
                else configError(call, reply, "read_error")
            }
        }
        on(router, "POST", "config/write", PUBLISH) { call, server ->
            val request = call.body()
            val project = request?.get("project_id")?.takeIf { it.isTextual && it.asText().isNotEmpty() }
            val files = request?.get("files")?.takeIf { it.isArray }
                ?.filter { it.path("path").isTextual && it.path("content").isTextual }
            val deletes = request?.get("deletes")?.filter { it.isTextual }.orEmpty()
            if (project == null || files == null || files.isEmpty() && deletes.isEmpty()) return@on call.error(422, "invalid_input")
            val message = mapOf("type" to "config_write", "project_id" to folder(server, project.asText()), "files" to files, "deletes" to deletes)
            relay.send(call, server, message) { reply ->
                if (ok(reply)) call.json(mapOf("ok" to true))
                else configError(call, reply, "write_error")
            }
        }

        on(router, "GET", "players", VIEW) { call, server ->
            server.link.request(mapOf("type" to "online_players_fetch")).whenComplete { reply, _ ->
                call.json(mapOf("players" to (reply?.takeIf(::ok)?.get("players") ?: emptyList<String>())))
            }
        }
        on(router, "GET", "papi-placeholders", VIEW) { call, server ->
            relay.send(call, server, mapOf("type" to "papi_placeholders_fetch")) { reply ->
                if (ok(reply)) call.json(mapOf("placeholders" to reply["placeholders"], "truncated" to reply["truncated"]))
                else call.error(502, "fetch_error")
            }
        }
        on(router, "GET", "head-texture", VIEW) { call, server ->
            val id = call.query("id")?.takeIf { HDB_ID.matches(it) } ?: return@on call.error(422, "invalid_input")
            relay.send(call, server, mapOf("type" to "head_texture_fetch", "id" to id)) { reply ->
                if (ok(reply)) call.json(mapOf("texture" to reply["texture"])) else readError(call, reply)
            }
        }
        on(router, "GET", "player-inventory", VIEW) { call, server ->
            val player = call.query("player")?.takeIf { it.isNotBlank() } ?: return@on call.error(422, "invalid_input")
            relay.send(call, server, mapOf("type" to "player_inventory_fetch", "player" to player)) { reply ->
                if (ok(reply)) call.json(mapOf("slots" to reply["slots"])) else readError(call, reply)
            }
        }
        // A module's editor view (runtime module bundles, level 3): announced at Presence, fetched once per hash.
        on(router, "GET", "modules/:module/ui.js", VIEW) { call, server ->
            val module = call.params["module"].orEmpty()
            val announced = server.announcement().editorBundle(module)?.get("hash") as? String
                ?: return@on call.error(404, "not_found")
            bundles.get(announced)?.let { return@on serveBundle(call, announced, it) }
            relay.send(call, server, mapOf("type" to "editor_bundle_fetch", "module_id" to module)) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
                val content = (reply["content"] as? String)?.toByteArray(Charsets.UTF_8)
                    ?: return@send call.error(502, "fetch_error", "editor bundle reply without content")
                val hash = BundleCache.sha256(content)
                // The announcement may be stale (the module reloaded since): serve only what it named.
                if (hash != reply["hash"] || hash != announced) {
                    return@send call.error(502, "fetch_error", "editor bundle of '$module' does not match its announced hash")
                }
                bundles.put(hash, content)
                serveBundle(call, hash, content)
            }
        }
        // A module's icon or logo (`ModuleBrandDeclaration`): announced at Presence, fetched once per hash.
        on(router, "GET", "modules/:module/brand/:file", VIEW) { call, server ->
            val module = call.params["module"].orEmpty()
            val name = call.params["file"].orEmpty().removeSuffix(".svg")
            val brand = server.announcement().brand(module) ?: return@on call.error(404, "not_found")
            val announced = brand["hash"] as? String ?: return@on call.error(404, "not_found")
            if ((brand["files"] as? List<*>)?.contains(name) != true) return@on call.error(404, "not_found")
            brands.get("$announced/$name")?.let { return@on serveBrandFile(call, announced, it) }
            relay.send(call, server, mapOf("type" to "module_brand_fetch", "module_id" to module)) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
                val files = (reply["files"] as? Map<*, *>)
                    ?.mapNotNull { (k, v) -> if (k is String && v is String) k to v.toByteArray(Charsets.UTF_8) else null }
                    ?.toMap()
                    ?: return@send call.error(502, "fetch_error", "module brand reply without files")
                // The announcement may be stale (the module reloaded since): serve only what it named.
                val hash = brandHash(files)
                if (hash != reply["hash"] || hash != announced) {
                    return@send call.error(502, "fetch_error", "brand of '$module' does not match its announced hash")
                }
                files.forEach { (file, content) -> brands.put("$hash/$file", content) }
                val content = files[name] ?: return@send call.error(404, "not_found")
                serveBrandFile(call, hash, content)
            }
        }
        // A module's template (ADR `module-templates`): its files, to show the default version read-only.
        on(router, "GET", "modules/:module/templates/:template", VIEW) { call, server ->
            if (!speaksTemplates(call, server)) return@on
            val message = mapOf(
                "type" to "template_fetch",
                "module_id" to call.params["module"].orEmpty(),
                "template_id" to call.params["template"].orEmpty(),
            )
            relay.send(call, server, message) { reply -> if (ok(reply)) call.json(body(reply)) else readError(call, reply) }
        }
        on(router, "POST", "data-sources/preview", VIEW) { call, server ->
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
            relay.send(call, server, message) { reply ->
                if (ok(reply)) call.json(body(reply)) else readError(call, reply)
            }
        }
    }

    /** `?v=<hash>` names this very script: the browser keeps it for good. Any other URL revalidates. */
    private fun serveBundle(call: Call, hash: String, content: ByteArray) {
        val cache = if (call.query("v") == hash) "private, max-age=31536000, immutable" else "no-cache"
        call.send(200, "text/javascript; charset=utf-8", content, cache, mapOf("X-Content-Type-Options" to "nosniff"))
    }

    /**
     * A module's SVG, shown through `<img>`. Served with a policy that runs nothing should it be
     * opened on its own (`sandbox`, no source allowed but inline styles); `?v=<hash>` keeps it for good.
     */
    private fun serveBrandFile(call: Call, hash: String, content: ByteArray) {
        val cache = if (call.query("v") == hash) "private, max-age=31536000, immutable" else "no-cache"
        call.send(
            200, "image/svg+xml; charset=utf-8", content, cache,
            mapOf(
                "X-Content-Type-Options" to "nosniff",
                "Content-Security-Policy" to "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            ),
        )
    }

    /** Config screens name their Project like the editor (`<server id>.shop`) or like the module (`shop`). */
    private fun folder(server: EditorServer, project: String) = project.removePrefix("${server.id}.")

    private fun configError(call: Call, reply: Map<String, Any?>, fallback: String) = readError(call, reply, fallback)

    private fun on(router: Router, method: String, suffix: String, permission: String, handler: (Call, EditorServer) -> Unit) {
        router.on(method, "$SERVER/$suffix", permission) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            handler(call, server)
        }
    }

    companion object {
        const val SERVER = "/api/v1/servers/:server"
        private val HDB_ID = Regex("[0-9]{1,10}")

        /** The files a brand may carry, in the order `ModuleBrandDeclaration` hashes them. */
        private val BRAND_FILES = listOf("icon", "logo-dark", "logo-light", "wordmark-dark", "wordmark-light")

        /** `ModuleBrandDeclaration.getHash()`: SHA-256 over each file's name, NUL, bytes, NUL, in [BRAND_FILES] order. */
        internal fun brandHash(files: Map<String, ByteArray>): String {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            for (name in BRAND_FILES) {
                val bytes = files[name] ?: continue
                digest.update(name.toByteArray(Charsets.UTF_8))
                digest.update(0)
                digest.update(bytes)
                digest.update(0)
            }
            return java.util.HexFormat.of().formatHex(digest.digest())
        }

        /** A leaf on an older release would ignore a template message: say so instead of waiting for the timeout. */
        fun speaksTemplates(call: Call, server: EditorServer): Boolean {
            if (ProtocolVersion.minor(server.protocolVersion) >= ProtocolVersion.TEMPLATES) return true
            call.error(501, "plugin_update_required")
            return false
        }
    }
}

/**
 * The editor bundles the hub served lately, by SHA-256: a bundle is fetched from its server once
 * per hash, not once per editor load. Least recently used first out, bounded in entries and bytes.
 */
internal class BundleCache(private val maxEntries: Int = 8, private val maxBytes: Long = 16L * 1024 * 1024) {
    private val entries = LinkedHashMap<String, ByteArray>(16, 0.75f, true)
    private var bytes = 0L

    @Synchronized
    fun get(hash: String): ByteArray? = entries[hash]

    @Synchronized
    fun put(hash: String, content: ByteArray) {
        if (content.size > maxBytes) return
        entries.remove(hash)?.let { bytes -= it.size }
        entries[hash] = content
        bytes += content.size
        val oldest = entries.entries.iterator()
        while ((entries.size > maxEntries || bytes > maxBytes) && oldest.hasNext()) {
            bytes -= oldest.next().value.size
            oldest.remove()
        }
    }

    companion object {
        fun sha256(content: ByteArray): String =
            java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(content))
    }
}
