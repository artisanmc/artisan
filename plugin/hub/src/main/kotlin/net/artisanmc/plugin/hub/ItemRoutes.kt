package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import net.artisanmc.plugin.hub.Relay.Companion.errorCode
import net.artisanmc.plugin.hub.Relay.Companion.ok
import java.util.Base64

/** Catalogue d'items (vanilla, puis Nexo, Oraxen, ItemsAdder), textures vanilla et glyphes Nexo. */
class ItemRoutes(private val servers: Servers, private val relay: Relay, private val vanilla: VanillaAssets?) {
    fun register(router: Router) {
        router.on("GET", "/api/v1/user/projects/:project/items", VIEW) { call ->
            val items = vanilla?.items ?: return@on call.error(404, "unknown_version")
            call.json(mapOf("version" to vanilla.catalogVersion, "items" to items))
        }
        router.on("GET", "/api/v1/user/projects/:project/custom-items", VIEW) { call ->
            val project = servers.projectOf(call) ?: return@on call.error(404, "not_found")
            call.json(mapOf("serverKeyId" to project.server.id, "items" to project.server.customItems()))
        }
        // La version demandée est ignorée : un seul serveur, une seule version de textures.
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
    }

    private fun glyphError(call: Call, reply: Map<String, Any?>) {
        val code = errorCode(reply)
        call.error(if (code == "not_found") 404 else 502, code)
    }
}
