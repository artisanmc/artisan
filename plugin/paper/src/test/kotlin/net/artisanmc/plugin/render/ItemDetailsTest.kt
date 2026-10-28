package net.artisanmc.plugin.render

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.model.AppearanceYaml
import org.bukkit.Color
import org.bukkit.Material
import org.bukkit.enchantments.Enchantment
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.ItemFlag
import org.bukkit.inventory.meta.LeatherArmorMeta
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import net.artisanmc.plugin.render.menu.ItemDetails

class ItemDetailsTest {

    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    private fun apply(app: AppearanceYaml, material: Material = Material.DIAMOND_SWORD): ItemStack {
        val item = ItemStack(material, 1)
        val meta = item.itemMeta!!
        ItemDetails.applyToMeta(app, meta)
        item.itemMeta = meta
        return item
    }

    // enchant id normalization

    @Test
    fun `normalizes namespaced, uppercase and legacy Bukkit enchant ids`() {
        assertEquals("sharpness", ItemDetails.normalizeEnchantId("minecraft:Sharpness"))
        assertEquals("sharpness", ItemDetails.normalizeEnchantId("SHARPNESS"))
        assertEquals("sharpness", ItemDetails.normalizeEnchantId("DAMAGE_ALL"))
        assertEquals("protection", ItemDetails.normalizeEnchantId("PROTECTION_ENVIRONMENTAL"))
        assertEquals("fortune", ItemDetails.normalizeEnchantId("LOOT_BONUS_BLOCKS"))
    }

    @Test
    fun `keeps a modded namespace intact`() {
        assertEquals("mymod:soulbound", ItemDetails.normalizeEnchantId("MyMod:Soulbound"))
    }

    // enchant parsing

    @Test
    fun `parses the canonical map form`() {
        val parsed = ItemDetails.parseEnchants(mapOf("sharpness" to 5, "unbreaking" to 3))
        assertEquals(listOf("sharpness" to 5, "unbreaking" to 3), parsed)
    }

    @Test
    fun `parses the list form and defaults a missing level to 1`() {
        val parsed = ItemDetails.parseEnchants(listOf(
            mapOf("id" to "minecraft:mending", "level" to 1),
            mapOf("id" to "lure"),
        ))
        assertEquals(listOf("mending" to 1, "lure" to 1), parsed)
    }

    @Test
    fun `parses string levels and floors below 1`() {
        assertEquals(listOf("sharpness" to 4), ItemDetails.parseEnchants(mapOf("sharpness" to "4")))
        assertEquals(listOf("sharpness" to 1), ItemDetails.parseEnchants(mapOf("sharpness" to 0)))
    }

    @Test
    fun `parses nothing from junk`() {
        assertTrue(ItemDetails.parseEnchants(null).isEmpty())
        assertTrue(ItemDetails.parseEnchants("sharpness").isEmpty())
        assertTrue(ItemDetails.parseEnchants(emptyMap<String, Any>()).isEmpty())
    }

    @Test
    fun `applies enchantments at the requested level`() {
        val item = apply(AppearanceYaml(enchants = mapOf("sharpness" to 5, "unbreaking" to 3)))
        assertEquals(5, item.getEnchantmentLevel(Enchantment.SHARPNESS))
        assertEquals(3, item.getEnchantmentLevel(Enchantment.UNBREAKING))
    }

    @Test
    fun `allows levels beyond the vanilla maximum`() {
        val item = apply(AppearanceYaml(enchants = mapOf("sharpness" to 10)))
        assertEquals(10, item.getEnchantmentLevel(Enchantment.SHARPNESS))
    }

    @Test
    fun `ignores an unknown enchant instead of failing the whole item`() {
        val item = apply(AppearanceYaml(enchants = mapOf("nope_not_real" to 1, "sharpness" to 2)))
        assertEquals(2, item.getEnchantmentLevel(Enchantment.SHARPNESS))
    }

    @Test
    fun `sets the glint override when enchanted is true`() {
        val item = apply(AppearanceYaml(enchanted = true))
        assertEquals(true, item.itemMeta!!.enchantmentGlintOverride)
    }

    @Test
    fun `leaves the glint override unset by default`() {
        assertFalse(apply(AppearanceYaml()).itemMeta!!.hasEnchantmentGlintOverride())
    }

    @Test
    fun `sets unbreakable`() {
        assertTrue(apply(AppearanceYaml(unbreakable = true)).itemMeta!!.isUnbreakable)
    }

    @Test
    fun `sets a numeric custom model data`() {
        val meta = apply(AppearanceYaml(customModelData = "42")).itemMeta!!
        assertTrue(meta.hasCustomModelData())
        assertEquals(42, meta.customModelData)
    }

    @Test
    fun `ignores a non-numeric custom model data rather than throwing`() {
        assertDoesNotThrow { apply(AppearanceYaml(customModelData = "banana")) }
    }

    @Test
    fun `applies hide flags from the short spelling`() {
        val meta = apply(AppearanceYaml(hide = listOf("attributes", "enchants"))).itemMeta!!
        assertTrue(meta.hasItemFlag(ItemFlag.HIDE_ATTRIBUTES))
        assertTrue(meta.hasItemFlag(ItemFlag.HIDE_ENCHANTS))
        assertFalse(meta.hasItemFlag(ItemFlag.HIDE_DYE))
    }

    @Test
    fun `accepts the Bukkit spelling of hide flags too`() {
        val meta = apply(AppearanceYaml(hide = listOf("HIDE_UNBREAKABLE"))).itemMeta!!
        assertTrue(meta.hasItemFlag(ItemFlag.HIDE_UNBREAKABLE))
    }

    @Test
    fun `ignores an unknown hide flag`() {
        assertDoesNotThrow { apply(AppearanceYaml(hide = listOf("nope"))) }
    }

    @Test
    fun `tints leather armor`() {
        val item = apply(AppearanceYaml(color = "#ff0000"), Material.LEATHER_CHESTPLATE)
        assertEquals(Color.fromRGB(0xff0000), (item.itemMeta as LeatherArmorMeta).color)
    }

    @Test
    fun `ignores a colour on a non-tintable material`() {
        assertDoesNotThrow { apply(AppearanceYaml(color = "#ff0000"), Material.DIAMOND_SWORD) }
    }

    @Test
    fun `ignores a malformed colour`() {
        val item = apply(AppearanceYaml(color = "rouge"), Material.LEATHER_BOOTS)
        // Untouched: still the default leather tint, not a crash.
        assertNotNull((item.itemMeta as LeatherArmorMeta).color)
    }

    @Test
    fun `applies nothing when no advanced field is set`() {
        val item = apply(AppearanceYaml(material = "DIAMOND_SWORD", count = 1))
        assertTrue(item.enchantments.isEmpty())
        assertFalse(item.itemMeta!!.isUnbreakable)
        assertTrue(item.itemMeta!!.itemFlags.isEmpty())
    }
}
