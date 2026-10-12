package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.customitems.CustomItemEntry
import net.artisanmc.plugin.customitems.CustomItemSource
import net.artisanmc.plugin.customitems.CustomItemsManager
import java.io.ByteArrayInputStream
import java.util.Base64
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CustomItemsManagerTest {

    private val jsonMapper = ObjectMapper()

    private fun fakeSource(ns: String, items: List<Pair<String, String>>): CustomItemSource =
        object : CustomItemSource {
            override val namespace = ns
            override fun isAvailable() = true
            override fun collectItems() = items.map { (id, label) ->
                CustomItemEntry(id = "$ns:$id", label = label, category = ns)
            }
        }

    private fun unavailableSource(): CustomItemSource =
        object : CustomItemSource {
            override val namespace = "missing"
            override fun isAvailable() = false
            override fun collectItems() = error("should not be called")
        }

    private fun decodeBundle(data: String): Pair<Set<String>, List<Map<String, String>>?> {
        val decoded = Base64.getDecoder().decode(data)
        val entries = mutableSetOf<String>()
        var itemsJson: ByteArray? = null
        ZipInputStream(GZIPInputStream(ByteArrayInputStream(decoded))).use { zip ->
            var e = zip.nextEntry
            while (e != null) {
                entries += e.name
                if (e.name == "items.json") itemsJson = zip.readBytes()
                e = zip.nextEntry
            }
        }
        val items: List<Map<String, String>>? = itemsJson?.let {
            @Suppress("UNCHECKED_CAST")
            jsonMapper.readValue(it, List::class.java) as List<Map<String, String>>
        }
        return entries to items
    }

    @Test fun `computeHash returns empty string when no sources available`() {
        val mgr = CustomItemsManager(listOf(unavailableSource()))
        assertEquals("", mgr.computeHash())
    }

    @Test fun `computeHash returns empty string when sources are empty`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", emptyList())))
        assertEquals("", mgr.computeHash())
    }

    @Test fun `computeHash is stable for same items`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin", "gem" to "Gem"))))
        assertEquals(mgr.computeHash(), mgr.computeHash())
    }

    @Test fun `computeHash changes when item set changes`() {
        val a = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin"))))
        val b = CustomItemsManager(listOf(fakeSource("nexo", listOf("gem" to "Gem"))))
        assertTrue(a.computeHash() != b.computeHash())
    }

    @Test fun `computeHash changes when only label changes`() {
        val a = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin"))))
        val b = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Iron Coin"))))
        assertTrue(a.computeHash() != b.computeHash())
    }

    @Test fun `computeHash does not collide between concatenated ids`() {
        val a = CustomItemsManager(listOf(fakeSource("nexo", listOf("ab" to "cd"))))
        val b = CustomItemsManager(listOf(fakeSource("nexo", listOf("abc" to "d"))))
        assertTrue(a.computeHash() != b.computeHash())
    }

    @Test fun `buildBundle returns null when no items available`() {
        assertNull(CustomItemsManager(listOf(unavailableSource())).buildBundle())
    }

    @Test fun `buildBundle zip contains only items_json — no textures or models`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Iron Coin"))))
        val (_, data) = assertNotNull(mgr.buildBundle())
        val (entries, items) = decodeBundle(data)

        assertEquals(setOf("items.json"), entries)
        assertNotNull(items)
        assertEquals(1, items!!.size)
        assertEquals("nexo:coin", items[0]["id"])
        assertEquals("Iron Coin", items[0]["label"])
        assertEquals("nexo", items[0]["category"])
    }

    @Test fun `buildBundle strips color codes from labels`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "§6Iron §rCoin"))))
        val (_, data) = assertNotNull(mgr.buildBundle())
        val (_, items) = decodeBundle(data)
        assertEquals("Iron Coin", items!![0]["label"])
    }

    @Test fun `buildBundle merges items from multiple sources sorted by id`() {
        val mgr = CustomItemsManager(listOf(
            fakeSource("oraxen", listOf("a" to "A")),
            fakeSource("nexo", listOf("z" to "Z", "a" to "A")),
        ))
        val (_, data) = assertNotNull(mgr.buildBundle())
        val (_, items) = decodeBundle(data)
        assertEquals(listOf("nexo:a", "nexo:z", "oraxen:a"), items!!.map { it["id"] })
    }

    @Test fun `stripColorCodes removes section-sign sequences`() {
        val mgr = CustomItemsManager(emptyList())
        assertEquals("Iron Coin", mgr.stripColorCodes("§6Iron §rCoin"))
    }

    @Test fun `NexoSource isAvailable returns false when Nexo plugin not installed`() {
        val source = net.artisanmc.plugin.customitems.NexoSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }

    @Test fun `OraxenSource isAvailable returns false when Oraxen plugin not installed`() {
        val source = net.artisanmc.plugin.customitems.OraxenSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }

    @Test fun `ItemsAdderSource isAvailable returns false when ItemsAdder plugin not installed`() {
        val source = net.artisanmc.plugin.customitems.ItemsAdderSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }
}
