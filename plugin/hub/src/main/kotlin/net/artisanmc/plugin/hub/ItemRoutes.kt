package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.AccountRoutes.Companion.LOCAL
import net.artisanmc.plugin.hub.EditorPermissions.VIEW

/** Catalogue d'items (vanilla, puis Nexo, Oraxen, ItemsAdder) et textures vanilla. */
class ItemRoutes(private val server: LocalServer, private val vanilla: VanillaAssets?) {
    fun register(router: Router) {
        router.on("GET", "/api/v1/user/projects/:project/items", VIEW) { call ->
            val items = vanilla?.items ?: return@on call.error(404, "unknown_version")
            call.json(mapOf("version" to vanilla.catalogVersion, "items" to items))
        }
        router.on("GET", "/api/v1/user/projects/:project/custom-items", VIEW) { call ->
            call.json(mapOf("serverKeyId" to LOCAL, "items" to server.customItems()))
        }
        // La version demandée est ignorée : un seul serveur, une seule version de textures.
        router.on("GET", "/api/v1/textures/:version/*", VIEW) { call ->
            val png = vanilla?.texture(call.params.getValue("*")) ?: return@on call.error(404, "not_found")
            call.send(200, "image/png", png, "private, max-age=86400")
        }
    }
}
