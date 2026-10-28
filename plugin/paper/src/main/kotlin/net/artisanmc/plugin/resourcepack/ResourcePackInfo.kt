package net.artisanmc.plugin.resourcepack

import java.util.UUID

/**
 * Resource pack identity + delivery URLs.
 *
 * @param url         External URL of the pack on the hub (e.g. `http://localhost:8765/resource-pack/...`):
 *                    the one players download in direct sending.
 * @param downloadUrl Plugin-side URL used by the plugin itself to download the pack (delegation,
 *                    AssetCatalog). In Docker setups this is the internal address of the hub
 *                    (e.g. `http://hub:8765/resource-pack/...`), because `localhost` inside a
 *                    leaf's container points to that container.
 * @param hash        Lowercase 40-char SHA-1 hex hash.
 */
data class ResourcePackInfo(
    val url: String,
    val downloadUrl: String,
    val hash: String,
) {
    /** Pack id on the client's pack stack: the same pack keeps the same id across restarts and servers. */
    val uuid: UUID get() = UUID.nameUUIDFromBytes(hash.toByteArray(Charsets.UTF_8))

    companion object {
        /** Pass the same value as [url] and [downloadUrl] when no split is needed. */
        fun from(url: String, downloadUrl: String, hash: String): ResourcePackInfo {
            require(hash.length == 40) { "hash must be 40 hex chars, got ${hash.length}" }
            return ResourcePackInfo(url, downloadUrl, hash)
        }

        /** Convenience: single-URL form (downloadUrl == url). */
        fun from(url: String, hash: String): ResourcePackInfo = from(url, url, hash)
    }
}
