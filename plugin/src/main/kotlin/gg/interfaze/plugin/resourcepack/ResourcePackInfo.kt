package gg.interfaze.plugin.resourcepack

import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage
import java.util.UUID

data class ResourcePackInfo(
    val url: String,
    val hash: String,
    val sha1Bytes: ByteArray,
    val uuid: UUID,
    val prompt: Component,
) {
    companion object {
        fun from(url: String, hash: String, promptMini: String): ResourcePackInfo {
            require(hash.length == 40) { "hash must be 40 hex chars, got ${hash.length}" }
            val sha1 = ByteArray(20)
            for (i in 0 until 20) {
                sha1[i] = ((Character.digit(hash[i * 2], 16) shl 4) or Character.digit(hash[i * 2 + 1], 16)).toByte()
            }
            val uuid = UUID.nameUUIDFromBytes(hash.toByteArray(Charsets.UTF_8))
            val component = MiniMessage.miniMessage().deserialize(promptMini)
            return ResourcePackInfo(url, hash, sha1, uuid, component)
        }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ResourcePackInfo) return false
        return url == other.url && hash == other.hash && uuid == other.uuid
    }

    override fun hashCode(): Int = 31 * url.hashCode() + hash.hashCode()
}
