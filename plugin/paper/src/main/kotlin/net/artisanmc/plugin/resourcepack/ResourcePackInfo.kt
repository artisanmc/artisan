package net.artisanmc.plugin.resourcepack

/**
 * Resource pack identity + delivery URLs.
 *
 * @param url         External URL of the pack on the hub (e.g. `http://localhost:8765/resource-pack/...`).
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
