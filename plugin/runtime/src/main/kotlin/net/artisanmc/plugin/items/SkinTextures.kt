package net.artisanmc.plugin.items

import com.destroystokyo.paper.profile.ProfileProperty
import net.artisanmc.plugin.platform.ServerPlatform
import org.bukkit.Bukkit
import org.bukkit.inventory.meta.SkullMeta
import java.net.URI
import java.util.Base64
import java.util.UUID

/**
 * Head textures. A `value` is the base64 of `{"textures":{"SKIN":{"url":"…"}}}`.
 * Paper keeps the value as given; Spigot only has the Bukkit profile API, which keeps
 * the skin URL alone, so a value read back there is re-encoded from that URL.
 */
object SkinTextures {
    private val URL = Regex("\"url\"\\s*:\\s*\"([^\"]+)\"")

    /** Puts the skin of [value] on [meta]; false when the value holds no skin. */
    fun apply(meta: SkullMeta, id: UUID, value: String): Boolean {
        if (ServerPlatform.paper) return PaperSkins.apply(meta, id, value)
        val url = skinUrl(value) ?: return false
        // getTextures is live: setting the skin sets the profile's.
        meta.ownerProfile = Bukkit.createPlayerProfile(id).apply { textures.skin = URI(url).toURL() }
        return true
    }

    /** The `value` of the skin [meta] wears; null without one. */
    fun value(meta: SkullMeta): String? =
        if (ServerPlatform.paper) PaperSkins.value(meta)
        else meta.ownerProfile?.textures?.skin?.let { encode(it.toString()) }

    fun skinUrl(value: String): String? {
        val json = runCatching { String(Base64.getMimeDecoder().decode(value.trim())) }.getOrNull() ?: return null
        return URL.find(json)?.groupValues?.get(1)
    }

    fun encode(skinUrl: String): String =
        Base64.getEncoder().encodeToString("""{"textures":{"SKIN":{"url":"$skinUrl"}}}""".toByteArray())
}

/** Paper's profile API: loaded on Paper only, Spigot has none of these classes. */
private object PaperSkins {
    fun apply(meta: SkullMeta, id: UUID, value: String): Boolean {
        val profile = Bukkit.createProfile(id)
        profile.setProperty(ProfileProperty("textures", value))
        meta.playerProfile = profile
        return true
    }

    fun value(meta: SkullMeta): String? =
        meta.playerProfile?.properties?.firstOrNull { it.name == "textures" }?.value
}
