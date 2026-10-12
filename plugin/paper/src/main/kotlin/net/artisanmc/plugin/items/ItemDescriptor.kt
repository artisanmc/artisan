package net.artisanmc.plugin.items

import net.artisanmc.plugin.engine.NexoItemRenderer
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.Material
import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.meta.SkullMeta

/**
 * Display-descriptor derivation for captured items (ADR
 * `captured-items-and-module-field-kit`). Read GENERICALLY from vanilla
 * components — no per-plugin branch — so any item from any plugin degrades to a
 * renderable descriptor: base material, head texture, glint, count, name. The
 * single optional enrichment asks the item sources to recognize the stack
 * (Nexo reverse-lookup) so the editor gets the real 3D icon when possible.
 * Every accessor is defensive: a descriptor field failing to derive is dropped,
 * never fatal (the opaque stack stays the runtime truth regardless).
 */
object ItemDescriptor {

    /** Canonical wrapped serialization (`item:` root key) — what CapturedItemStore reads. */
    fun serialize(stack: ItemStack): String {
        val yml = YamlConfiguration()
        yml.set("item", stack)
        return yml.saveToString()
    }

    fun derive(stack: ItemStack, nexo: NexoItemRenderer?): Map<String, Any> {
        val out = HashMap<String, Any>()
        // Material — enriched to a recognized custom ref when possible.
        val nexoId = runCatching { nexo?.idFrom(stack) }.getOrNull()
        out["material"] = if (nexoId != null) "nexo:$nexoId" else stack.type.name
        if (stack.amount > 1) out["count"] = stack.amount

        val meta = runCatching { stack.itemMeta }.getOrNull()
        if (meta != null) {
            if (runCatching { meta.hasEnchants() }.getOrDefault(false)) out["enchanted"] = true
            runCatching {
                meta.displayName()?.let {
                    out["name"] = PlainTextComponentSerializer.plainText().serialize(it)
                }
            }
            if (stack.type == Material.PLAYER_HEAD && meta is SkullMeta) {
                runCatching {
                    meta.playerProfile?.properties
                        ?.firstOrNull { it.name == "textures" }
                        ?.value
                        ?.let { out["head_texture"] = it }
                }
            }
        }
        return out
    }
}
