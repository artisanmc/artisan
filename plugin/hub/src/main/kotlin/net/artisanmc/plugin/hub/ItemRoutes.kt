package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import net.artisanmc.plugin.hub.Relay.Companion.errorCode
import net.artisanmc.plugin.hub.Relay.Companion.ok
import com.fasterxml.jackson.databind.ObjectMapper
import java.util.Base64

/** Item catalog (vanilla, then Nexo, Oraxen, ItemsAdder), vanilla textures, Nexo glyphs and Nexo item icons. */
class ItemRoutes(private val servers: Servers, private val relay: Relay, private val vanilla: VanillaAssets?) {
    private val mapper = ObjectMapper()

    fun register(router: Router) {
        router.on("GET", "/api/v1/user/projects/:project/items", VIEW) { call ->
            val items = vanilla?.items ?: return@on call.error(404, "unknown_version")
            call.json(mapOf("version" to vanilla.catalogVersion, "items" to items))
        }
        router.on("GET", "/api/v1/user/projects/:project/custom-items", VIEW) { call ->
            val project = servers.projectOf(call) ?: return@on call.error(404, "not_found")
            call.json(mapOf("serverKeyId" to project.server.id, "items" to project.server.customItems()))
        }
        // The requested version is ignored: one server, one texture version.
        router.on("GET", "/api/v1/textures/:version/*", VIEW) { call ->
            val png = vanilla?.texture(call.params.getValue("*")) ?: return@on call.error(404, "not_found")
            call.send(200, "image/png", png, "private, max-age=86400")
        }
        router.on("GET", "/api/v1/user/projects/:project/nexo-glyphs", VIEW) { call ->
            val project = servers.projectOf(call) ?: return@on call.error(404, "not_found")
            relay.send(call, project.server, mapOf("type" to "nexo_glyphs_list")) { reply ->
                if (ok(reply)) call.json(mapOf("glyphs" to (reply["glyphs"] ?: emptyList<Any>()))) else glyphError(call, reply)
            }
        }
        router.on("GET", "/api/v1/user/projects/:project/nexo-glyphs/:glyph", VIEW) { call ->
            val project = servers.projectOf(call) ?: return@on call.error(404, "not_found")
            relay.send(call, project.server, mapOf("type" to "nexo_glyph_read", "glyph_id" to call.params["glyph"])) { reply ->
                val content = reply["content_base64"] as? String
                if (!ok(reply) || content == null) return@send glyphError(call, reply)
                call.send(200, "image/png", Base64.getDecoder().decode(content), "private, no-cache")
            }
        }
        // Every Nexo item's icon in one answer, read by its server from Nexo's pack (no Nexo API).
        // The ETag is the set's hash: an editor that holds it gets a 304, and its server sends nothing.
        router.on("GET", "/api/v1/user/projects/:project/nexo-item-icons", VIEW) { call ->
            val project = servers.projectOf(call) ?: return@on call.error(404, "not_found")
            val known = call.header("If-None-Match")?.removePrefix("W/")?.trim('"')?.takeIf { it.isNotEmpty() }
            relay.send(call, project.server, mapOf("type" to "nexo_item_icons_fetch", "known_hash" to known)) { reply ->
                if (!ok(reply)) return@send glyphError(call, reply)
                val etag = mapOf("ETag" to "\"${reply["hash"] ?: ""}\"")
                if (reply["unchanged"] == true) return@send call.send(304, "application/json", ByteArray(0), "private, no-cache", etag)
                call.send(
                    200, "application/json",
                    mapper.writeValueAsBytes(mapOf("icons" to (reply["icons"] ?: emptyMap<String, String>()))),
                    "private, no-cache", etag,
                )
            }
        }
    }

    private fun glyphError(call: Call, reply: Map<String, Any?>) {
        val code = errorCode(reply)
        call.error(if (code == "not_found") 404 else 502, code)
    }
}
