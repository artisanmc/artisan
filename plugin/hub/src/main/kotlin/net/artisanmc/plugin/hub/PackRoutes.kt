package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.PUBLISH
import net.artisanmc.plugin.hub.ServerRoutes.Companion.SERVER

/**
 * The packs the editor builds arrive here. The hub serves them itself (`/resource-pack/<sha1>.zip`,
 * `/bedrock-pack/<sha1>.mcpack`, public). The Java pack, with [cdn], is also uploaded to Artisan's
 * pack host, where players then download it; either way it goes to `ResourcePackManager`:
 * delegation to the pack plugin or direct push. The Bedrock pack goes to `BedrockPackManager`
 * (Geyser hands it to Bedrock players), never to the host: Geyser downloads it, not the players.
 * `GET SERVER/bedrock-pack` (public) tells a Geyser elsewhere (the Artisan Geyser extension on a
 * proxy) which Bedrock pack is current.
 *
 * Building a Java pack is an Artisan Pro feature: the free [edition] refuses a new one (403
 * `pro_required`) but keeps serving the packs it already has, so content made with Pro still
 * renders after a switch to the free jar. The Bedrock pack is accepted in every edition.
 */
class PackRoutes(
    private val servers: Servers,
    private val store: PackStore,
    private val cdn: PackCdn? = null,
    private val edition: Edition = Edition.PRO,
    private val bedrock: PackStore? = null,
    /** Told of each pack the editor uploads ([PackBuilder.editorUploaded], shadow mode). */
    private val uploaded: (server: String, hash: String) -> Unit = { _, _ -> },
    /** Told of each Bedrock pack the editor uploads ([PackBuilder.bedrockApplied]). */
    private val bedrockUploaded: (server: String, hash: String) -> Unit = { _, _ -> },
) {
    fun register(router: Router) {
        router.on("PUT", "$SERVER/resource-pack", PUBLISH) { call ->
            if (!edition.pro) return@on call.error(403, PRO_REQUIRED)
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            val zip = receive(call) ?: return@on
            val hash = store.put(zip)
            uploaded(server.id, hash)
            // The host down or refusing: players download from the hub, as without one.
            val url = cdn?.publish(hash) { zip }
            server.applyResourcePack(hash, store.pathOf(hash), url)
            call.json(if (url == null) mapOf("hash" to hash) else mapOf("hash" to hash, "url" to url))
        }
        serve(router, store)
        bedrock?.let { packs ->
            router.on("PUT", "$SERVER/bedrock-pack", PUBLISH) { call ->
                val server = servers.of(call) ?: return@on call.error(404, "not_found")
                val zip = receive(call) ?: return@on
                val hash = packs.put(zip)
                server.applyBedrockPack(hash, packs.pathOf(hash))
                bedrockUploaded(server.id, hash)
                call.json(mapOf("hash" to hash))
            }
            serve(router, packs)
            // The Artisan Geyser extension on a proxy polls this to follow the server's pack.
            router.on("GET", "$SERVER/bedrock-pack", null) { call ->
                val server = servers.of(call) ?: return@on call.error(404, "not_found")
                val pack = server.bedrockPack() ?: return@on call.error(404, "no_pack")
                call.json(pack)
            }
        }
    }

    /** The request's zip, or null once the refusal is sent. */
    private fun receive(call: Call): ByteArray? {
        val zip = call.bytes(MAX_BYTES) ?: return null.also { call.error(413, "too_large") }
        if (zip.size < 4 || zip[0] != 'P'.code.toByte() || zip[1] != 'K'.code.toByte()) return null.also { call.error(422, "invalid_zip") }
        return zip
    }

    private fun serve(router: Router, store: PackStore) {
        router.on("GET", "${store.path}/:file", null) { call ->
            val zip = store.get(call.params.getValue("file")) ?: return@on call.error(404, "not_found")
            call.send(200, "application/zip", zip, "public, max-age=31536000, immutable")
        }
    }

    companion object {
        private const val MAX_BYTES = 100 * 1024 * 1024
        const val PRO_REQUIRED = "pro_required"
    }
}
