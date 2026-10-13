package net.artisanmc.plugin.resourcepack

import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage
import java.util.UUID

/**
 * Resource project identity + delivery URLs.
 *
 * @param url         External URL used by the player's Minecraft client to download the project
 *                    (e.g. `http://localhost:8765/resource-pack/...`). Must be reachable
 *                    from the player's machine.
 * @param downloadUrl Plugin-side URL used by the plugin itself to download the project (e.g. for
 *                    AssetCatalog extraction). In Docker setups this is the internal address
 *                    of the hub (e.g. `http://hub:8765/resource-pack/...`), because `localhost`
 *                    inside a leaf's container points to that container.
 * @param hash        Lowercase 40-char SHA-1 hex hash.
 * @param sha1Bytes   Raw 20-byte SHA-1 (decoded from [hash]).
 * @param uuid        Deterministic UUID derived from [hash].
 * @param prompt      MiniMessage-rendered prompt component.
 */
data class ResourcePackInfo(
    val url: String,
    val downloadUrl: String,
    val hash: String,
    val sha1Bytes: ByteArray,
    val uuid: UUID,
    val prompt: Component,
) {
    companion object {
        /**
         * Build a [ResourcePackInfo] with explicit player and plugin-side URLs.
         *
         * @param url         External URL (player-facing).
         * @param downloadUrl Internal URL (plugin-facing). Pass the same value as [url] if no
         *                    split is needed (single-host deployments).
         * @param hash        40-char lowercase hex SHA-1.
         * @param promptMini  MiniMessage prompt.
         */
        fun from(url: String, downloadUrl: String, hash: String, promptMini: String): ResourcePackInfo {
            require(hash.length == 40) { "hash must be 40 hex chars, got ${hash.length}" }
            val sha1 = ByteArray(20)
            for (i in 0 until 20) {
                sha1[i] = ((Character.digit(hash[i * 2], 16) shl 4) or Character.digit(hash[i * 2 + 1], 16)).toByte()
            }
            val uuid = UUID.nameUUIDFromBytes(hash.toByteArray(Charsets.UTF_8))
            val component = MiniMessage.miniMessage().deserialize(promptMini)
            return ResourcePackInfo(url, downloadUrl, hash, sha1, uuid, component)
        }

        /** Convenience: single-URL form (downloadUrl == url). */
        fun from(url: String, hash: String, promptMini: String): ResourcePackInfo =
            from(url, url, hash, promptMini)
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ResourcePackInfo) return false
        return url == other.url && downloadUrl == other.downloadUrl && hash == other.hash && uuid == other.uuid
    }

    override fun hashCode(): Int {
        var h = url.hashCode()
        h = 31 * h + downloadUrl.hashCode()
        h = 31 * h + hash.hashCode()
        return h
    }
}
