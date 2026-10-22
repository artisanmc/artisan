package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.PUBLISH
import net.artisanmc.plugin.hub.ServerRoutes.Companion.SERVER

/**
 * The packs the editor builds arrive here. The server serves them to players
 * itself (`/resource-pack/<sha1>.zip`, `/bedrock-pack/<sha1>.mcpack`, public)
 * and hands them to the plugin: the Java pack to `ResourcePackManager`
 * (delegation to the pack host), the Bedrock pack to `BedrockPackManager`
 * (Geyser hands it to Bedrock players). `GET SERVER/bedrock-pack` (public) tells a
 * Geyser elsewhere which one is current.
 */
class PackRoutes(private val servers: Servers, private val store: PackStore, private val bedrock: PackStore? = null) {
    fun register(router: Router) {
        register(router, store, "resource-pack") { server, hash, path -> server.applyResourcePack(hash, path) }
        bedrock?.let {
            register(router, it, "bedrock-pack") { server, hash, path -> server.applyBedrockPack(hash, path) }
            // The Artisan Geyser extension on a proxy polls this to follow the server's pack.
            router.on("GET", "$SERVER/bedrock-pack", null) { call ->
                val server = servers.of(call) ?: return@on call.error(404, "not_found")
                val pack = server.bedrockPack() ?: return@on call.error(404, "no_pack")
                call.json(pack)
            }
        }
    }

    private fun register(router: Router, store: PackStore, route: String, apply: (EditorServer, String, String) -> Unit) {
        router.on("PUT", "$SERVER/$route", PUBLISH) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            val zip = call.bytes(MAX_BYTES) ?: return@on call.error(413, "too_large")
            if (zip.size < 4 || zip[0] != 'P'.code.toByte() || zip[1] != 'K'.code.toByte()) return@on call.error(422, "invalid_zip")
            val hash = store.put(zip)
            apply(server, hash, store.pathOf(hash))
            call.json(mapOf("hash" to hash))
        }
        router.on("GET", "${store.path}/:file", null) { call ->
            val zip = store.get(call.params.getValue("file")) ?: return@on call.error(404, "not_found")
            call.send(200, "application/zip", zip, "public, max-age=31536000, immutable")
        }
    }

    companion object {
        private const val MAX_BYTES = 100 * 1024 * 1024
    }
}
