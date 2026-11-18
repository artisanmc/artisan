package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.plugin.hub.EditorPermissions.CONFIG
import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import net.artisanmc.plugin.hub.Relay.Companion.ok
import net.artisanmc.plugin.hub.Relay.Companion.readError
import net.artisanmc.plugin.protocol.ProtocolVersion
import java.util.logging.Level
import java.util.logging.Logger

/**
 * The site account and what it lets a server install (ADR `site-account-and-module-updates`).
 * `view` to read, `config` to link, unlink and install. The token never leaves the hub towards a
 * browser; a download address and its hash come from the site, never from the request.
 */
class SiteRoutes(private val servers: Servers, private val relay: Relay, private val account: SiteAccount, private val logger: Logger?) {
    fun register(router: Router) {
        router.on("GET", LINK, VIEW) { call ->
            // Collecting the token is a call to the site: off the request's thread.
            call.offload {
                account.poll()
                call.json(status(call))
            }
        }
        router.on("POST", LINK, CONFIG) { call ->
            val name = call.body()?.path("name")?.asText("")?.trim()?.take(60)?.takeIf { it.isNotEmpty() }
                ?: servers.local.label.take(60).ifEmpty { "Artisan" }
            call.offload {
                try {
                    account.start(name)
                    call.json(status(call), 201)
                } catch (e: SiteFailure) {
                    call.error(502, e.code, e.message)
                } catch (e: Exception) {
                    call.error(503, "database_unavailable")
                }
            }
        }
        router.on("DELETE", LINK, CONFIG) { call ->
            call.offload {
                try {
                    account.unlink()
                    call.json(status(call))
                } catch (e: Exception) {
                    call.error(503, "database_unavailable")
                }
            }
        }

        // What the account may install on this server, and what the server runs.
        router.on("GET", "$SERVER/updates", VIEW) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            val channel = channel(call.query("channel")) ?: return@on call.error(422, "invalid_input", "channel")
            if (account.link() == null) return@on call.error(409, "site_not_linked")
            if (!speaksInstalls(call, server)) return@on
            relay.send(call, server, mapOf("type" to "plugins_fetch")) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
                val plugins = strings(reply["plugins"])
                call.offload {
                    site(call) {
                        val catalogue = account.updates(channel, ModuleUpdates.installed(catalogueIds(channel), plugins))
                        call.json(
                            mapOf(
                                "channel" to channel,
                                "modules" to ModuleUpdates.rows(catalogue, plugins, reply["staged"]),
                                // A server on an older release has no restart to ask for.
                                "canRestart" to (ProtocolVersion.minor(server.protocolVersion) >= ProtocolVersion.SERVER_RESTART),
                            ),
                        )
                    }
                }
            }
        }
        router.on("POST", "$SERVER/updates/install", CONFIG) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            val body = call.body()
            val module = body?.path("module")?.asText("")?.takeIf { MODULE_ID.matches(it) } ?: return@on call.error(422, "invalid_input", "module")
            val channel = channel(body.path("channel").asText("").ifEmpty { null }) ?: return@on call.error(422, "invalid_input", "channel")
            val token = account.link()?.token ?: return@on call.error(409, "site_not_linked")
            if (!speaksInstalls(call, server)) return@on
            call.offload {
                site(call) {
                    val entry = account.updates(channel, emptyMap()).path("modules").firstOrNull { it.path("id").asText() == module }
                        ?: return@site call.error(404, "unknown_module")
                    // `supporter`: a free module's development builds, kept for the site's Supporter plan.
                    val access = entry.path("access").asText()
                    if (access != "ok") return@site call.error(403, if (access == "supporter") "supporter_required" else "licence_required")
                    val latest = entry.path("latest").takeIf { it.isObject } ?: return@site call.error(404, "no_release")
                    val message = mapOf(
                        "type" to "module_install",
                        "plugin" to entry.path("plugin").asText(),
                        "version" to latest.path("version").asText(),
                        "url" to latest.path("download").asText(),
                        "sha256" to latest.path("sha256").asText(),
                        "size" to latest.path("size").asLong(),
                        "token" to token,
                    )
                    relay.send(call, server, message) { reply ->
                        if (!ok(reply)) return@send readError(call, reply)
                        logger?.info("[Artisan] ${call.session?.playerName ?: "an editor"} asked ${server.label} to install ${message["plugin"]} ${message["version"]}")
                        call.json(mapOf("ok" to true, "plugin" to message["plugin"], "version" to message["version"]), 202)
                    }
                }
            }
        }
        // Restarts the server so the jars it staged load. Whether it comes back up is its host's doing.
        router.on("POST", "$SERVER/updates/restart", CONFIG) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            if (ProtocolVersion.minor(server.protocolVersion) < ProtocolVersion.SERVER_RESTART) return@on call.error(501, "plugin_update_required")
            relay.send(call, server, mapOf("type" to "server_restart")) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
                logger?.info("[Artisan] ${call.session?.playerName ?: "an editor"} asked ${server.label} to restart")
                call.json(mapOf("ok" to true, "seconds" to ((reply["seconds"] as? Number)?.toInt() ?: 0)), 202)
            }
        }
    }

    /** The link as the editor shows it: never the token, nor the code the hub collects it with. */
    private fun status(call: Call): Map<String, Any?> {
        val link = account.link()
        val pending = account.pending().takeIf { link == null }
        return mapOf(
            "site" to account.baseUrl,
            "linked" to (link != null),
            "name" to link?.name,
            "linkedAt" to link?.linkedAt?.toString(),
            "canManage" to (call.session?.can(CONFIG) == true),
            "pending" to pending?.let {
                mapOf(
                    "userCode" to it.userCode,
                    "verificationUrl" to it.verificationUrl,
                    "expiresAt" to it.expiresAt.toString(),
                )
            },
        )
    }

    /** Module id by plugin name, as the site names them: asked once, then kept ten minutes. */
    @Volatile private var ids: Pair<Long, Map<String, String>>? = null

    private fun catalogueIds(channel: String): Map<String, String> {
        ids?.takeIf { System.nanoTime() - it.first < IDS_TTL_NANOS }?.let { return it.second }
        return ModuleUpdates.ids(account.updates(channel, emptyMap())).also { ids = System.nanoTime() to it }
    }

    private inline fun site(call: Call, task: () -> Unit) = try {
        task()
    } catch (e: SiteFailure) {
        if (e.code == "site_not_linked") call.error(409, e.code) else call.error(502, e.code, e.message)
    } catch (e: Exception) {
        logger?.log(Level.WARNING, "[Artisan] site request failed", e)
        call.error(500, "internal_error")
    }

    private fun strings(value: Any?): Map<String, String> =
        (value as? Map<*, *>)?.mapNotNull { (k, v) -> if (k is String && v is String) k to v else null }?.toMap().orEmpty()

    /** A server on an older release would ignore the message: say so instead of waiting for the timeout. */
    private fun speaksInstalls(call: Call, server: EditorServer): Boolean {
        if (ProtocolVersion.minor(server.protocolVersion) >= ProtocolVersion.MODULE_INSTALL) return true
        call.error(501, "plugin_update_required")
        return false
    }

    companion object {
        const val LINK = "/api/v1/site/link"
        private const val SERVER = ServerRoutes.SERVER
        private const val IDS_TTL_NANOS = 600_000_000_000L
        private val MODULE_ID = Regex("[a-z0-9-]{1,40}")

        /** `release` unless asked `dev`; anything else is refused. */
        fun channel(asked: String?): String? = when (asked) {
            null, "release" -> "release"
            "dev" -> "dev"
            else -> null
        }
    }
}

/** The site's catalogue set against what a server runs. Pure. */
object ModuleUpdates {
    private val VERSION = Regex("""\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?""")

    /** Module id by plugin name. */
    fun ids(catalogue: JsonNode): Map<String, String> =
        catalogue.path("modules").mapNotNull { m ->
            val plugin = m.path("plugin").asText("")
            val id = m.path("id").asText("")
            if (plugin.isEmpty() || id.isEmpty()) null else plugin to id
        }.toMap()

    /** What the server runs, by module id: only versions the site can compare. */
    fun installed(ids: Map<String, String>, plugins: Map<String, String>): Map<String, String> =
        plugins.mapNotNull { (plugin, version) ->
            val id = ids[plugin] ?: return@mapNotNull null
            if (VERSION.matches(version)) id to version else null
        }.toMap()

    /**
     * One row per module of the catalogue. `installed` is the version the server runs, even one
     * the site cannot compare; `staged` what waits for its restart, as the server reports it.
     */
    fun rows(catalogue: JsonNode, plugins: Map<String, String>, staged: Any?): List<Map<String, Any?>> {
        val waiting = staged as? Map<*, *> ?: emptyMap<Any?, Any?>()
        return catalogue.path("modules").map { m ->
            val plugin = m.path("plugin").asText("")
            val running = plugins[plugin]
            val latest = m.path("latest").takeIf { it.isObject }
            val latestVersion = latest?.path("version")?.asText()
            mapOf(
                "id" to m.path("id").asText(),
                "name" to m.path("name").asText(),
                "plugin" to plugin,
                "tagline" to Call.mapper.convertValue(m.path("tagline"), Any::class.java),
                "price" to Call.mapper.convertValue(m.path("price"), Any::class.java),
                "requires" to m.path("requires").map { it.asText() },
                "page" to m.path("page").asText("").ifEmpty { null },
                "installed" to running,
                "access" to m.path("access").asText("ok"),
                "latest" to latest?.let {
                    mapOf(
                        "version" to latestVersion,
                        "changelog" to it.path("changelog").asText(""),
                        "size" to it.path("size").asLong(),
                        "published" to it.path("published").asText("").ifEmpty { null },
                    )
                },
                // A version the site cannot compare (a local build) is offered the latest one.
                "update" to (running != null && latestVersion != null && running != latestVersion &&
                    (m.path("update").asBoolean(false) || !VERSION.matches(running))),
                "staged" to waiting[plugin],
            )
        }
    }
}
