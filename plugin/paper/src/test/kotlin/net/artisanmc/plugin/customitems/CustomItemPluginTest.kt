package net.artisanmc.plugin.customitems

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.items.ItemDescriptor
import org.bukkit.Material
import org.bukkit.inventory.ItemStack
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class CustomItemPluginTest {
    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    private class Fake(override val namespace: String, private val known: String) : CustomItemPlugin {
        override val pluginName = "Fake"
        override val itemsLoadedEvent = "fake.ItemsLoaded"
        override fun hasApi() = true
        override fun collectItems() = emptyList<CustomItemEntry>()
        override fun buildStack(id: String, count: Int) =
            if (id == known) ItemStack(Material.DIAMOND, count.coerceAtLeast(1)) else null
        override fun idFrom(stack: ItemStack) = if (stack.type == Material.DIAMOND) known else null
    }

    @Test fun `a material builds through the plugin of its namespace`() {
        val deps = SoftDepRegistry(null, null, null, customItems = listOf(Fake("one", "coin"), Fake("two", "gem")))

        assertEquals(Material.DIAMOND, deps.buildCustomStack("two:gem", 3)?.type)
        assertEquals(3, deps.buildCustomStack("two:gem", 3)?.amount)
        assertNull(deps.buildCustomStack("one:gem", 1), "the namespace picks the plugin")
        assertNull(deps.buildCustomStack("nexo:gem", 1), "no plugin, no stack")
    }

    @Test fun `a captured stack is named after the first plugin that recognizes it`() {
        val plugins = listOf(Fake("one", "coin"), Fake("two", "gem"))

        assertEquals("one:coin", ItemDescriptor.derive(ItemStack(Material.DIAMOND), plugins)["material"])
        assertEquals("STONE", ItemDescriptor.derive(ItemStack(Material.STONE), plugins)["material"])
        assertEquals("DIAMOND", ItemDescriptor.derive(ItemStack(Material.DIAMOND))["material"])
    }

    @Test fun `the integrated plugins keep their namespaces, order and Bukkit names`() {
        assertEquals(listOf("nexo", "oraxen", "itemsadder"), CustomItemPlugins.ALL.map { it.namespace })
        assertEquals(listOf("Nexo", "Oraxen", "ItemsAdder"), CustomItemPlugins.ALL.map { it.pluginName })
        CustomItemPlugins.ALL.forEach { assertFalse(it.isAvailable(), "${it.pluginName} is not installed under MockBukkit") }
    }
}
