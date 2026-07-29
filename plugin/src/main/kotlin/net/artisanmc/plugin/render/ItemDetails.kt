package net.artisanmc.plugin.render

import net.artisanmc.plugin.model.AppearanceYaml
import org.bukkit.Bukkit
import org.bukkit.Color
import org.bukkit.NamespacedKey
import org.bukkit.Registry
import org.bukkit.enchantments.Enchantment
import org.bukkit.inventory.ItemFlag
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.meta.ItemMeta
import org.bukkit.inventory.meta.LeatherArmorMeta
import org.bukkit.inventory.meta.PotionMeta
import java.util.logging.Logger

/**
 * Applies the advanced details of an [AppearanceYaml] — enchantments, glint,
 * custom model data, unbreakable, hidden tooltip sections, tint, raw NBT.
 *
 * Every field is best-effort by design: a bad enchant id or a malformed SNBT
 * must never take down the whole menu, so each step is individually guarded
 * and failures are logged once at WARN. Readers accept the loose spellings a
 * hand-written YAML file produces (see the editor's `domain/itemAdvanced.ts`,
 * which mirrors this normalization).
 */
object ItemDetails {

    private val logger: Logger = Logger.getLogger("Artisan")

    /** Pre-1.20.5 Bukkit constant names, still found in hand-written configs. */
    private val LEGACY_ENCHANT_IDS = mapOf(
        "protection_environmental" to "protection",
        "protection_fire" to "fire_protection",
        "protection_fall" to "feather_falling",
        "protection_explosions" to "blast_protection",
        "protection_projectile" to "projectile_protection",
        "oxygen" to "respiration",
        "water_worker" to "aqua_affinity",
        "damage_all" to "sharpness",
        "damage_undead" to "smite",
        "damage_arthropods" to "bane_of_arthropods",
        "loot_bonus_mobs" to "looting",
        "sweeping" to "sweeping_edge",
        "dig_speed" to "efficiency",
        "durability" to "unbreaking",
        "loot_bonus_blocks" to "fortune",
        "arrow_damage" to "power",
        "arrow_knockback" to "punch",
        "arrow_fire" to "flame",
        "arrow_infinite" to "infinity",
        "luck" to "luck_of_the_sea",
    )

    private val HIDE_FLAGS = mapOf(
        "enchants" to ItemFlag.HIDE_ENCHANTS,
        "attributes" to ItemFlag.HIDE_ATTRIBUTES,
        "unbreakable" to ItemFlag.HIDE_UNBREAKABLE,
        "destroys" to ItemFlag.HIDE_DESTROYS,
        "placed_on" to ItemFlag.HIDE_PLACED_ON,
        "additional" to ItemFlag.HIDE_ADDITIONAL_TOOLTIP,
        "dye" to ItemFlag.HIDE_DYE,
        "armor_trim" to ItemFlag.HIDE_ARMOR_TRIM,
        "stored_enchants" to ItemFlag.HIDE_STORED_ENCHANTS,
    )

    /** `minecraft:Sharpness`, `SHARPNESS`, `DAMAGE_ALL` → `sharpness`. */
    fun normalizeEnchantId(raw: String): String {
        val lower = raw.trim().lowercase()
        val bare = lower.removePrefix("minecraft:")
        return LEGACY_ENCHANT_IDS[bare] ?: bare
    }

    private fun toLevel(raw: Any?): Int {
        val n = when (raw) {
            is Number -> raw.toInt()
            is String -> raw.trim().toIntOrNull() ?: 1
            else -> 1
        }
        return if (n >= 1) n else 1
    }

    /** Map form `{id: level}` or list form `[{id, level}]` → ordered id/level pairs. */
    fun parseEnchants(raw: Any?): List<Pair<String, Int>> = when (raw) {
        is Map<*, *> -> raw.mapNotNull { (k, v) ->
            val id = (k as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            normalizeEnchantId(id) to toLevel(v)
        }
        is List<*> -> raw.mapNotNull { entry ->
            val map = entry as? Map<*, *> ?: return@mapNotNull null
            val id = (map["id"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            normalizeEnchantId(id) to toLevel(map["level"])
        }
        else -> emptyList()
    }

    private fun lookupEnchant(id: String): Enchantment? {
        val key = if (id.contains(':')) NamespacedKey.fromString(id) else NamespacedKey.minecraft(id)
        if (key == null) return null
        return runCatching { Registry.ENCHANTMENT.get(key) }.getOrNull()
    }

    /**
     * Applies every advanced field that lives on the meta. The stack itself is
     * untouched — [applyNbt] handles the one field that needs to replace it.
     */
    fun applyToMeta(app: AppearanceYaml, meta: ItemMeta) {
        for ((id, level) in parseEnchants(app.enchants)) {
            val ench = lookupEnchant(id)
            if (ench == null) {
                logger.warning("Unknown enchantment '$id' — ignored")
                continue
            }
            // ignoreLevelRestriction: over-max levels are legal and servers use them.
            runCatching { meta.addEnchant(ench, level, true) }
                .onFailure { logger.warning("Could not apply enchantment '$id' level $level: ${it.message}") }
        }

        // Real enchantments already glint; the override only matters on its own.
        if (app.enchanted) {
            runCatching { meta.setEnchantmentGlintOverride(true) }
                .onFailure { logger.warning("Glint override unsupported on this server: ${it.message}") }
        }

        app.customModelData?.trim()?.takeIf { it.isNotEmpty() }?.let { cmd ->
            val asInt = cmd.toIntOrNull()
            if (asInt != null) {
                runCatching { meta.setCustomModelData(asInt) }
                    .onFailure { logger.warning("Could not set custom_model_data '$cmd': ${it.message}") }
            } else {
                // 1.21.4 allows string custom model data through the component.
                runCatching {
                    val component = meta.customModelDataComponent
                    component.strings = listOf(cmd)
                    meta.setCustomModelDataComponent(component)
                }.onFailure { logger.warning("Non-numeric custom_model_data '$cmd' unsupported here: ${it.message}") }
            }
        }

        if (app.unbreakable) meta.isUnbreakable = true

        for (raw in app.hide) {
            val flag = HIDE_FLAGS[raw.trim().lowercase().removePrefix("hide_")]
                ?: HIDE_FLAGS[raw.trim().lowercase()]
            if (flag == null) {
                logger.warning("Unknown hide flag '$raw' — ignored")
                continue
            }
            meta.addItemFlags(flag)
        }

        app.color?.let { raw ->
            val rgb = parseColor(raw)
            if (rgb == null) {
                logger.warning("Malformed color '$raw' — expected #rrggbb")
                return@let
            }
            when (meta) {
                is LeatherArmorMeta -> meta.setColor(Color.fromRGB(rgb))
                is PotionMeta -> meta.color = Color.fromRGB(rgb)
                else -> {} // Not a tintable item — silently irrelevant, not an error.
            }
        }
    }

    private fun parseColor(raw: String): Int? {
        val hex = raw.trim().removePrefix("#")
        if (!hex.matches(Regex("[0-9a-fA-F]{6}"))) return null
        return hex.toInt(16)
    }

    /**
     * Applies the raw SNBT escape hatch, last, after every other field.
     * Returns the original stack untouched when there is no `nbt` or when the
     * server rejects it — a bad snippet must not blank the item.
     */
    fun applyNbt(app: AppearanceYaml, item: ItemStack): ItemStack {
        val snbt = app.nbt?.trim()?.takeIf { it.isNotEmpty() } ?: return item
        return runCatching {
            @Suppress("DEPRECATION")
            Bukkit.getUnsafe().modifyItemStack(item, snbt)
        }.getOrElse {
            logger.warning("Could not apply nbt '$snbt': ${it.message}")
            item
        }
    }
}
