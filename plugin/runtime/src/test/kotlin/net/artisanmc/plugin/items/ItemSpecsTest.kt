package net.artisanmc.plugin.items

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.item.ItemComparison
import net.artisanmc.modules.api.item.ItemComparison.*
import net.artisanmc.plugin.customitems.CustomItemEntry
import net.artisanmc.plugin.customitems.CustomItemPlugin
import net.kyori.adventure.text.Component
import org.bukkit.Material
import org.bukkit.enchantments.Enchantment
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.meta.Damageable
import org.bukkit.NamespacedKey
import org.bukkit.persistence.PersistentDataType
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class ItemSpecsTest {
    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    private object Gems : CustomItemPlugin {
        override val namespace = "gems"
        override val pluginName = "Gems"
        override val itemsLoadedEvent = "gems.Loaded"
        override fun hasApi() = true
        override fun collectItems() = emptyList<CustomItemEntry>()
        override fun buildStack(id: String, count: Int) =
            if (id == "ruby") ItemStack(Material.EMERALD, count).apply { editMeta { it.setCustomModelData(7) } } else null
        override fun idFrom(stack: ItemStack) =
            if (stack.type == Material.EMERALD && stack.itemMeta?.hasCustomModelData() == true) "ruby" else null
    }

    private var captured: ItemStack? = null

    private val specs = ItemSpecs(
        buildCustom = { material, count ->
            when {
                material.startsWith("item:") -> captured?.clone()
                material.startsWith("gems:") -> Gems.buildStack(material.removePrefix("gems:"), count)
                else -> null
            }
        },
        customItems = { listOf(Gems) },
    )

    private fun rod(lure: Int, damage: Int = 0, tagged: Boolean = false) = ItemStack(Material.FISHING_ROD).apply {
        addUnsafeEnchantment(Enchantment.LURE, lure)
        editMeta { meta ->
            (meta as Damageable).damage = damage
            if (tagged) meta.persistentDataContainer.set(NamespacedKey("test", "shop"), PersistentDataType.STRING, "spawn")
        }
    }

    @Test fun `a spec builds a vanilla, custom or captured stack`() {
        assertEquals(Material.DIAMOND, specs.build(mapOf("material" to "diamond", "count" to 3))?.type)
        assertEquals(3, specs.build(mapOf("material" to "DIAMOND", "count" to 3))?.amount)
        assertEquals(Material.EMERALD, specs.build(mapOf("material" to "gems:ruby"))?.type)
        captured = rod(3)
        assertEquals(Material.FISHING_ROD, specs.build(mapOf("material" to "item:rod"))?.type)
        assertNull(specs.build(mapOf("material" to "no_such_item")))
        assertNull(specs.build(emptyMap<String, Any>()))
    }

    @Test fun `a captured item matches another stack with the same enchants and no more wear`() {
        captured = rod(lure = 3, tagged = true)
        val spec = mapOf("material" to "item:rod")

        assertEquals(setOf(MATERIAL, CUSTOM_ITEM, ENCHANTS, DAMAGE), specs.defaultComparisons(spec))
        assertTrue(specs.matches(spec, rod(lure = 3), emptySet()), "hidden tags are not compared")
        assertTrue(specs.matches(spec, rod(lure = 3).apply { addUnsafeEnchantment(Enchantment.UNBREAKING, 1) }, emptySet()))
        assertFalse(specs.matches(spec, rod(lure = 2), emptySet()))
        assertFalse(specs.matches(spec, rod(lure = 3, damage = 10), emptySet()), "a damaged rod is not an intact one")
        val renamed = rod(lure = 3, tagged = true).apply { editMeta { it.displayName(Component.text("Old rod")) } }
        assertTrue(specs.matches(spec, renamed, emptySet()), "the captured item has no name to compare")
        // EXACT is Bukkit's isSimilar, which MockBukkit's item factory does not implement faithfully.
        assertFalse(specs.matches(spec, ItemStack(Material.STICK), setOf(EXACT)))
    }

    @Test fun `the chosen criteria are the only ones compared`() {
        val spec = mapOf("material" to "DIAMOND_SWORD", "title" to "<red>Excalibur", "lore" to listOf("Old"))
        val named = ItemStack(Material.DIAMOND_SWORD).apply { editMeta { it.displayName(Component.text("Excalibur")); it.lore(listOf(Component.text("Old"))) } }

        assertEquals(setOf(MATERIAL, CUSTOM_ITEM, NAME, LORE, DAMAGE), specs.defaultComparisons(spec))
        assertTrue(specs.matches(spec, named, emptySet()), "colours are ignored")
        assertFalse(specs.matches(spec, ItemStack(Material.DIAMOND_SWORD), emptySet()))
        assertTrue(specs.matches(spec, ItemStack(Material.DIAMOND_SWORD), setOf(MATERIAL)))
        assertFalse(specs.matches(spec, ItemStack(Material.IRON_SWORD), setOf(MATERIAL)))
        assertFalse(specs.matches(spec, null, setOf(MATERIAL)))
    }

    @Test fun `a custom item is recognized by its plugin`() {
        val spec = mapOf("material" to "gems:ruby")

        assertEquals(setOf(CUSTOM_ITEM, CUSTOM_MODEL_DATA, DAMAGE), specs.defaultComparisons(spec))
        assertTrue(specs.matches(spec, Gems.buildStack("ruby", 5)!!, emptySet()), "the amount is never compared")
        assertFalse(specs.matches(spec, ItemStack(Material.EMERALD), emptySet()))
        assertTrue(specs.matches(spec, ItemStack(Material.EMERALD), setOf(MATERIAL)))
    }

    @Test fun `a vanilla item refuses a custom item of its material by default`() {
        val spec = mapOf("material" to "EMERALD")

        assertEquals(setOf(MATERIAL, CUSTOM_ITEM, DAMAGE), specs.defaultComparisons(spec))
        assertTrue(specs.matches(spec, ItemStack(Material.EMERALD), emptySet()))
        assertFalse(specs.matches(spec, Gems.buildStack("ruby", 1)!!, emptySet()))
        assertTrue(specs.matches(spec, Gems.buildStack("ruby", 1)!!, setOf(MATERIAL)))
    }

    @Test fun `comparisons read their wire ids`() {
        assertEquals(CUSTOM_ITEM, ItemComparison.fromId("custom_item"))
        assertEquals(DAMAGE, ItemComparison.fromId(" Damage "))
        assertNull(ItemComparison.fromId("repair"))
        assertEquals("custom_model_data", CUSTOM_MODEL_DATA.id())
    }
}
