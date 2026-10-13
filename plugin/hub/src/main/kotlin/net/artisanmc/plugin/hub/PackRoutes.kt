package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.PUBLISH
import net.artisanmc.plugin.hub.ServerRoutes.Companion.SERVER

/**
 * Le pack que l'éditeur construit arrive ici. Le serveur le sert lui-même aux joueurs
 * (`/resource-pack/<sha1>.zip`, public comme l'était celui du backend) et le remet au
 * `ResourcePackManager` : délégation à l'hôte de pack ou envoi direct, inchangés.
 */
class PackRoutes(private val servers: Servers, private val store: PackStore) {
    fun register(router: Router) {
        router.on("PUT", "$SERVER/resource-pack", PUBLISH) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            val zip = call.bytes(MAX_BYTES) ?: return@on call.error(413, "too_large")
            if (zip.size < 4 || zip[0] != 'P'.code.toByte() || zip[1] != 'K'.code.toByte()) return@on call.error(422, "invalid_zip")
            val hash = store.put(zip)
            server.applyResourcePack(hash, "${PackStore.PATH}/$hash.zip")
            call.json(mapOf("hash" to hash))
        }
        router.on("GET", "${PackStore.PATH}/:file", null) { call ->
            val zip = store.get(call.params.getValue("file")) ?: return@on call.error(404, "not_found")
            call.send(200, "application/zip", zip, "public, max-age=31536000, immutable")
        }
    }

    companion object {
        private const val MAX_BYTES = 100 * 1024 * 1024
    }
}
