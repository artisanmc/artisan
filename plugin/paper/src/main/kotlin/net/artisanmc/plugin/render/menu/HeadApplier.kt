package net.artisanmc.plugin.render.menu

import com.destroystokyo.paper.profile.ProfileProperty
import net.artisanmc.plugin.integrations.SoftDepRegistry
import org.bukkit.Bukkit
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.meta.SkullMeta
import java.util.concurrent.ConcurrentHashMap
import net.artisanmc.plugin.render.HeadRef

/**
 * Applies AppearanceYaml.head (already interpolated) to a PLAYER_HEAD item.
 * Unavailable source or invalid value → bare head + a single WARN per key.
 */
object HeadApplier {
    private val warned = ConcurrentHashMap.newKeySet<String>()

    fun apply(item: ItemStack, rawHead: String, deps: SoftDepRegistry): ItemStack {
        val ref = HeadRef.parse(rawHead) ?: run {
            warnOnce("unparseable:$rawHead", "head \"$rawHead\" not recognized — expected hdb:<id>, basehead:<base64> or playerhead:<name>")
            return item
        }
        return when (ref) {
            is HeadRef.Hdb -> deps.hdbHeads?.buildStack(ref.id, item.amount) ?: run {
                warnOnce("hdb-missing", "head \"hdb:${ref.id}\" requires the HeadDatabase plugin — rendering a plain player head")
                item
            }
            is HeadRef.Base64 -> item.also { stack ->
                val meta = stack.itemMeta as? SkullMeta ?: return@also
                val profile = Bukkit.createProfile(HeadRef.uuidFor(ref.value))
                profile.setProperty(ProfileProperty("textures", ref.value))
                meta.playerProfile = profile
                stack.itemMeta = meta
            }
            is HeadRef.PlayerName -> item.also { stack ->
                val meta = stack.itemMeta as? SkullMeta ?: return@also
                meta.owningPlayer = Bukkit.getOfflinePlayer(ref.name)
                stack.itemMeta = meta
            }
        }
    }

    private fun warnOnce(key: String, message: String) {
        if (warned.add(key)) Bukkit.getLogger().warning("[Artisan] $message")
    }
}
