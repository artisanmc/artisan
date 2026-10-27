package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.PUBLISH
import net.artisanmc.plugin.hub.ServerRoutes.Companion.SERVER

/**
 * The pack the editor builds arrives here. The server serves it to players itself
 * (`/resource-pack/<sha1>.zip`, public) and hands it to `ResourcePackManager`:
 * delegation to the pack host or direct push.
 *
 * Building a pack is an Artisan Pro feature: the free [edition] refuses a new one (403
 * `pro_required`) but keeps serving the packs it already has, so content made with Pro still
 * renders after a switch to the free jar.
 */
class PackRoutes(private val servers: Servers, private val store: PackStore, private val edition: Edition = Edition.PRO) {
    fun register(router: Router) {
        router.on("PUT", "$SERVER/resource-pack", PUBLISH) { call ->
            if (!edition.pro) return@on call.error(403, PRO_REQUIRED)
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
        const val PRO_REQUIRED = "pro_required"
    }
}
