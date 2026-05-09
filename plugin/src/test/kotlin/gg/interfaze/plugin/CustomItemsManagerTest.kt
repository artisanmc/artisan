package gg.interfaze.plugin

import gg.interfaze.plugin.customitems.CustomItemEntry
import gg.interfaze.plugin.customitems.CustomItemSource
import gg.interfaze.plugin.customitems.CustomItemsManager
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream
import java.io.ByteArrayInputStream
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class CustomItemsManagerTest {

    private fun fakeSource(namespace: String, items: List<Pair<String, String>>): CustomItemSource =
        object : CustomItemSource {
            override val namespace = namespace
            override fun isAvailable() = true
            override fun collectItems() = items.map { (id, label) ->
                CustomItemEntry(id = "$namespace:$id", label = label, texturePath = "$namespace/$id")
            }
            override fun loadTexture(path: String) = "fake-png-$path".toByteArray()
        }

    private fun unavailableSource(): CustomItemSource =
        object : CustomItemSource {
            override val namespace = "missing"
            override fun isAvailable() = false
            override fun collectItems() = error("should not be called")
            override fun loadTexture(path: String) = null
        }

    @Test
    fun `computeHash returns empty string when no sources available`() {
        val mgr = CustomItemsManager(listOf(unavailableSource()))
        assertEquals("", mgr.computeHash())
    }

    @Test
    fun `computeHash returns empty string when sources are empty`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", emptyList())))
        assertEquals("", mgr.computeHash())
    }

    @Test
    fun `computeHash is stable for same items`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin", "gem" to "Gem"))))
        assertEquals(mgr.computeHash(), mgr.computeHash())
    }

    @Test
    fun `computeHash changes when item set changes`() {
        val mgr1 = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Coin"))))
        val mgr2 = CustomItemsManager(listOf(fakeSource("nexo", listOf("gem" to "Gem"))))
        val h1 = mgr1.computeHash()
        val h2 = mgr2.computeHash()
        assertTrue(h1.isNotEmpty() && h2.isNotEmpty() && h1 != h2)
    }

    @Test
    fun `buildBundle returns null when no items available`() {
        val mgr = CustomItemsManager(listOf(unavailableSource()))
        assertEquals(null, mgr.buildBundle())
    }

    @Test
    fun `buildBundle returns valid base64 gzip zip with items json and textures`() {
        val mgr = CustomItemsManager(listOf(fakeSource("nexo", listOf("coin" to "Iron Coin"))))
        val result = assertNotNull(mgr.buildBundle())
        val (_, data) = result

        // Decode base64 → gunzip → zip entries
        val decoded = Base64.getDecoder().decode(data)
        val entries = mutableSetOf<String>()
        ZipInputStream(GZIPInputStream(ByteArrayInputStream(decoded))).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                entries += entry.name
                entry = zip.nextEntry
            }
        }
        assertTrue("items.json" in entries)
        assertTrue("textures/nexo/coin.png" in entries)
    }

    @Test
    fun `stripColorCodes removes section-sign sequences`() {
        val mgr = CustomItemsManager(emptyList())
        assertEquals("Iron Coin", mgr.stripColorCodes("§6Iron §rCoin"))
    }

    @Test
    fun `NexoSource isAvailable returns false when Nexo plugin not installed`() {
        val source = gg.interfaze.plugin.customitems.NexoSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }

    @Test
    fun `OraxenSource isAvailable returns false when Oraxen plugin not installed`() {
        val source = gg.interfaze.plugin.customitems.OraxenSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }

    @Test
    fun `ItemsAdderSource isAvailable returns false when ItemsAdder plugin not installed`() {
        val source = gg.interfaze.plugin.customitems.ItemsAdderSource(java.io.File("/nonexistent"))
        assertFalse(source.isAvailable())
    }

    @Test
    fun `items without texture use placeholder and are still included`() {
        val sourceWithMissing = object : CustomItemSource {
            override val namespace = "nexo"
            override fun isAvailable() = true
            override fun collectItems() = listOf(
                CustomItemEntry("nexo:coin", "Coin", "nexo/coin"),
                CustomItemEntry("nexo:missing", "Missing", "nexo/missing"),
            )
            override fun loadTexture(path: String) = if (path == "nexo/coin") "png".toByteArray() else null
        }
        val mgr = CustomItemsManager(listOf(sourceWithMissing))
        val (_, data) = assertNotNull(mgr.buildBundle())

        val decoded = Base64.getDecoder().decode(data)
        val entries = mutableSetOf<String>()
        ZipInputStream(GZIPInputStream(ByteArrayInputStream(decoded))).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                entries += entry.name
                entry = zip.nextEntry
            }
        }
        // Both items included: one with real texture, one with placeholder
        assertTrue("textures/nexo/coin.png" in entries)
        assertTrue("textures/nexo/missing.png" in entries)
    }
}
