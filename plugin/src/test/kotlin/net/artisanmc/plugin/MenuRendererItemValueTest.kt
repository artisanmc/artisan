package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.Material
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.bukkit.NamespacedKey
import org.bukkit.Registry

class MenuRendererItemValueTest {
    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    @Test fun `catalog icon supplies amount and metadata underneath template presentation`() {
        for (overrideCount in listOf(0, 1, 8)) verifyIcon(overrideCount)
    }

    @Test fun `legacy template lore reads a migrated catalogue icon once`() {
        val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
            schema: menu/v1
            id: shop
            size: 9
            elements:
              - id: product
                positions: 0
                item: "{item.icon}"
                lore: ["{item.lore}", "Price"]
        """.trimIndent())
        val icon = mapOf("extends" to mapOf("material" to "STONE", "lore" to listOf("Original")), "lore" to listOf("{base.lore}", "Rare"))
        val player = MockBukkit.getMock()!!.addPlayer()
        MenuRenderer.open(player, BundleCompiler.compile(yaml, emptyMap()), "en", ExecutionContext(player,
            args = mapOf("item" to mapOf("icon" to icon, "lore" to ""))))
        val plain = PlainTextComponentSerializer.plainText()
        assertEquals(listOf("Original", "Rare", "Price"), player.openInventory.topInventory.getItem(0)!!.itemMeta!!.lore()!!.map(plain::serialize))
    }

    @Test fun `recursive extensions render their immediate base and replace lore`() {
        val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
            schema: menu/v1
            id: shop
            size: 9
            elements:
              - id: product
                positions: 0
                item: "{item.icon}"
                lore_mode: replace
                lore: ["Offer", "{base.lore}", "Price: {item.price}"]
        """.trimIndent())
        val original = mapOf("material" to "DIAMOND_SWORD", "title" to "Original", "lore" to listOf("Captured lore"), "count" to 2)
        val icon = mapOf("extends" to "{original}", "title" to "{item.name}", "lore" to listOf("{base.lore}", "Rare"), "count" to 4)
        val player = MockBukkit.getMock()!!.addPlayer()
        MenuRenderer.open(player, BundleCompiler.compile(yaml, emptyMap()), "en", ExecutionContext(player,
            args = mapOf("original" to original, "item" to mapOf("name" to "Rare sword", "price" to 100, "icon" to icon))))
        val stack = player.openInventory.topInventory.getItem(0)!!
        val plain = PlainTextComponentSerializer.plainText()
        assertEquals(Material.DIAMOND_SWORD, stack.type)
        assertEquals(4, stack.amount)
        assertEquals("Rare sword", plain.serialize(stack.itemMeta!!.displayName()!!))
        assertEquals(listOf("Offer", "Captured lore", "Rare", "Price: 100"), stack.itemMeta!!.lore()!!.map(plain::serialize))
    }

    @Test fun `an explicitly empty replacement clears inherited lore`() {
        val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
            schema: menu/v1
            id: shop
            size: 9
            elements:
              - id: product
                positions: 0
                item: "{item.icon}"
                lore_mode: replace
                lore: [""]
        """.trimIndent())
        val player = MockBukkit.getMock()!!.addPlayer()
        val icon = mapOf("extends" to mapOf("material" to "STONE", "lore" to listOf("Inherited")))
        MenuRenderer.open(player, BundleCompiler.compile(yaml, emptyMap()), "en", ExecutionContext(player,
            args = mapOf("item" to mapOf("icon" to icon))))
        assertTrue(player.openInventory.topInventory.getItem(0)!!.itemMeta!!.lore().isNullOrEmpty())
    }

    private fun verifyIcon(overrideCount: Int) {
        val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
            schema: menu/v1
            id: shop
            size: 9
            elements:
              - id: product
                positions: 0
                item: "{item.icon}"
                title: "Offer"
                lore: ["Price: 10"]
                ${if (overrideCount == 0) "" else "count: $overrideCount"}
        """.trimIndent())
        val icon = mapOf("material" to "DIAMOND_SWORD", "count" to 3,
            "title" to "Sword", "lore" to listOf("Rare"), "unbreakable" to true,
            "enchants" to mapOf("sharpness" to 5))
        val player = MockBukkit.getMock()!!.addPlayer()
        val menu = BundleCompiler.compile(yaml, emptyMap())
        MenuRenderer.open(player, menu, "en", ExecutionContext(player, args = mapOf("item" to mapOf("icon" to icon))))
        val stack = player.openInventory.topInventory.getItem(0)!!
        assertEquals(Material.DIAMOND_SWORD, stack.type)
        assertEquals(if (overrideCount == 0) 3 else overrideCount, stack.amount)
        assertEquals(5, stack.getEnchantmentLevel(Registry.ENCHANTMENT.get(NamespacedKey.minecraft("sharpness"))!!))
        assertTrue(stack.itemMeta!!.isUnbreakable)
        val plain = PlainTextComponentSerializer.plainText()
        assertEquals("Offer", plain.serialize(stack.itemMeta!!.displayName()!!))
        assertEquals(listOf("Rare", "Price: 10"), stack.itemMeta!!.lore()!!.map(plain::serialize))
    }
}
