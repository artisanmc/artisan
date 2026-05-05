package gg.interfaze.plugin.render

import gg.interfaze.plugin.model.AppearanceYaml
import gg.interfaze.plugin.model.BundleMenu
import net.kyori.adventure.text.Component
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.ItemStack

object MenuRenderer {

    fun open(player: Player, menu: BundleMenu, lang: String) {
        val titleText = menu.resolveTitle(lang)
        val inv = Bukkit.createInventory(null, menu.yaml.size, titleText)
        populate(inv, menu, lang)
        player.openInventory(inv)
    }

    private fun populate(inv: Inventory, menu: BundleMenu, lang: String) {
        val langMap = menu.langMaps[lang] ?: emptyMap()
        for (layer in menu.yaml.layers) {
            for (element in layer.elements) {
                val appearance = element.appearances.firstOrNull() ?: continue
                val item = buildItem(appearance, langMap)
                for (slot in parsePositions(element.positions, menu.yaml.size)) {
                    inv.setItem(slot, item)
                }
            }
        }
    }

    private fun buildItem(app: AppearanceYaml, langMap: Map<String, String>): ItemStack {
        val material = app.material
            ?.let { runCatching { Material.valueOf(it.uppercase()) }.getOrNull() }
            ?: Material.STONE
        val item = ItemStack(material, app.count.coerceAtLeast(1))
        val meta = item.itemMeta ?: return item
        if (app.title != null) {
            val resolved = resolveI18n(app.title, langMap)
            meta.displayName(Component.text(resolved))
        }
        if (app.lore.isNotEmpty()) {
            meta.lore(app.lore.map { Component.text(resolveI18n(it, langMap)) })
        }
        item.itemMeta = meta
        return item
    }

    private fun resolveI18n(raw: String, langMap: Map<String, String>): String {
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMap[key] ?: raw
    }

    /**
     * Parses a positions string like "13", "0,8", or "0-8" into slot indices.
     * Slots outside the inventory size are silently dropped.
     */
    private fun parsePositions(positions: String, size: Int): List<Int> =
        positions.split(",").flatMap { part ->
            val t = part.trim()
            if (t.contains("-")) {
                val (a, b) = t.split("-").map { it.trim().toInt() }
                (a..b).toList()
            } else {
                listOf(t.toIntOrNull() ?: return@flatMap emptyList())
            }
        }.filter { it in 0 until size }
}
