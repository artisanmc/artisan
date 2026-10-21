package net.artisanmc.plugin.items

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.item.ItemComparison
import net.artisanmc.plugin.customitems.CustomItemPlugin
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.render.menu.ItemDetails
import net.artisanmc.plugin.text.LenientText
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.Material
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.meta.Damageable
import java.util.EnumSet
import java.util.logging.Logger

/**
 * A module's item spec (`api.items.build` / `matches`): the fields of a menu button's appearance,
 * built without a player the way a menu builds them (captured `item:<id>`, `<namespace>:<id>` of a
 * custom-items plugin, else a vanilla material), and compared to a player's stack criterion by
 * criterion ([ItemComparison]).
 */
class ItemSpecs(
    /** `item:<id>` and `<namespace>:<id>` materials, null for anything else ([SoftDepRegistry.buildCustomStack]). */
    private val buildCustom: (material: String, count: Int) -> ItemStack?,
    /** The custom-items plugins a stack is recognized by. */
    private val customItems: () -> List<CustomItemPlugin>,
    private val logger: Logger = Logger.getLogger("Artisan"),
) {
    fun build(spec: Map<String, *>): ItemStack? {
        val app = appearance(spec) ?: return null
        val material = (app.item ?: app.material ?: app.extends as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val count = (app.count ?: 1).coerceIn(1, 64)
        val item = buildCustom(material, count)
            ?: Material.matchMaterial(material)?.takeIf { it.isItem && !it.isAir }?.let { ItemStack(it, count) }
            ?: return null
        if (app.count != null) item.amount = count
        item.itemMeta?.let { meta ->
            app.title?.allValues()?.firstOrNull()?.let { meta.displayName(text(it)) }
            if (app.lore.isNotEmpty()) meta.lore(app.lore.map { text(it.allValues().firstOrNull().orEmpty()) })
            ItemDetails.applyToMeta(app, meta)
            item.itemMeta = meta
        }
        return ItemDetails.applyNbt(app, item)
    }

    fun matches(spec: Map<String, *>, stack: ItemStack?, comparisons: Set<ItemComparison>): Boolean {
        if (stack == null || stack.type.isAir) return false
        val expected = build(spec) ?: return false
        val criteria = comparisons.ifEmpty { defaultComparisons(spec) }
        return criteria.all { agrees(it, expected, stack) }
    }

    fun defaultComparisons(spec: Map<String, *>): Set<ItemComparison> {
        val item = build(spec) ?: return EnumSet.of(ItemComparison.MATERIAL, ItemComparison.CUSTOM_ITEM)
        // A vanilla item also asks CUSTOM_ITEM: a custom item built on its material is not it.
        val set = if (customId(item) != null) EnumSet.of(ItemComparison.CUSTOM_ITEM)
        else EnumSet.of(ItemComparison.MATERIAL, ItemComparison.CUSTOM_ITEM)
        val meta = item.itemMeta ?: return set
        if (meta.hasDisplayName()) set += ItemComparison.NAME
        if (!meta.lore().isNullOrEmpty()) set += ItemComparison.LORE
        if (item.enchantments.isNotEmpty()) set += ItemComparison.ENCHANTS
        if (modelData(item) != null) set += ItemComparison.CUSTOM_MODEL_DATA
        // Always: an item that cannot wear has no damage, so it holds; the editor ticks it alike.
        set += ItemComparison.DAMAGE
        return set
    }

    private fun agrees(criterion: ItemComparison, expected: ItemStack, stack: ItemStack): Boolean = when (criterion) {
        ItemComparison.MATERIAL -> expected.type == stack.type
        ItemComparison.CUSTOM_ITEM -> customId(expected) == customId(stack)
        ItemComparison.NAME -> plain(expected.itemMeta?.takeIf { it.hasDisplayName() }?.displayName()) ==
            plain(stack.itemMeta?.takeIf { it.hasDisplayName() }?.displayName())
        ItemComparison.LORE -> lore(expected) == lore(stack)
        ItemComparison.ENCHANTS -> {
            val have = stack.enchantments
            expected.enchantments.all { (enchant, level) -> (have[enchant] ?: 0) >= level }
        }
        ItemComparison.CUSTOM_MODEL_DATA -> modelData(expected) == modelData(stack)
        ItemComparison.DAMAGE -> damage(stack) <= damage(expected)
        ItemComparison.EXACT -> expected.isSimilar(stack)
    }

    private fun customId(stack: ItemStack): String? = customItems().firstNotNullOfOrNull { plugin ->
        runCatching { plugin.idFrom(stack) }.getOrNull()?.let { "${plugin.namespace}:$it" }
    }

    private fun lore(stack: ItemStack): List<String> = stack.itemMeta?.lore()?.map { plain(it).orEmpty() }.orEmpty()

    private fun damage(stack: ItemStack): Int = (stack.itemMeta as? Damageable)?.takeIf { it.hasDamage() }?.damage ?: 0

    private fun modelData(stack: ItemStack): Any? {
        val meta = stack.itemMeta ?: return null
        if (meta.hasCustomModelData()) return runCatching { meta.customModelData }.getOrNull()
        return runCatching { meta.customModelDataComponent.strings.takeIf { it.isNotEmpty() } }.getOrNull()
    }

    private fun appearance(spec: Map<String, *>): AppearanceYaml? {
        val fields = spec.entries.associate { it.key.toString() to it.value }.toMutableMap()
        if (fields["lore"] is String) fields["lore"] = listOf(fields["lore"])
        return runCatching { mapper.convertValue(fields, AppearanceYaml::class.java) }
            .onFailure { logger.warning("[Artisan] unreadable item spec $spec: ${it.message}") }
            .getOrNull()
    }

    private fun text(raw: String): Component = LenientText.parse(raw)

    private fun plain(component: Component?): String? = component?.let { PlainTextComponentSerializer.plainText().serialize(it) }

    private companion object {
        val mapper: ObjectMapper = ObjectMapper().registerKotlinModule()
            .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
    }
}
