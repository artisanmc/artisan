package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.bukkit.Material
import org.bukkit.enchantments.Enchantment
import org.bukkit.inventory.ItemStack
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PlayerInventoryFetchTest {
    private val mapper = ObjectMapper()
    private lateinit var server: ServerMock

    @BeforeEach fun setup() { server = MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    private fun provider(sink: MutableList<Map<String, Any?>>, latch: CountDownLatch): SyncedMenuProvider {
        val dir = Files.createTempDirectory("artisan_inv_").toFile()
        val p = SyncedMenuProvider(
            projectsDir = dir, serverKey = "", wsUrl = "", logger = null,
            runOnMainThread = { task -> task() },
        )
        p.load()
        p.setSendForTesting { raw ->
            @Suppress("UNCHECKED_CAST")
            sink.add(mapper.readValue(raw, Map::class.java) as Map<String, Any?>)
            latch.countDown()
        }
        return p
    }

    private fun await(latch: CountDownLatch) =
        assertTrue(latch.await(5, TimeUnit.SECONDS), "no player_inventory_result sent within 5s")

    @Test
    fun `snapshots non-empty slots with generic display descriptors`() {
        val player = server.addPlayer("Steve")
        player.inventory.setItem(0, ItemStack(Material.DIAMOND_SWORD, 1).also {
            val meta = it.itemMeta
            meta.addEnchant(Enchantment.SHARPNESS, 3, true)
            it.itemMeta = meta
        })
        player.inventory.setItem(5, ItemStack(Material.PAPER, 5))

        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(sink, latch)
        p.handleMessageForTesting("""{"type":"player_inventory_fetch","request_id":"r1","player":"Steve"}""")
        await(latch)

        val msg = sink[0]
        assertEquals("player_inventory_result", msg["type"])
        assertEquals(true, msg["ok"])
        @Suppress("UNCHECKED_CAST")
        val slots = msg["slots"] as List<Map<String, Any?>>
        assertEquals(2, slots.size)

        val bySlot = slots.associateBy { (it["slot"] as Number).toInt() }
        @Suppress("UNCHECKED_CAST")
        val sword = bySlot[0]!!["display"] as Map<String, Any?>
        assertEquals("DIAMOND_SWORD", sword["material"])
        assertEquals(true, sword["enchanted"])
        @Suppress("UNCHECKED_CAST")
        val paper = bySlot[5]!!["display"] as Map<String, Any?>
        assertEquals("PAPER", paper["material"])
        assertEquals(5, (paper["count"] as Number).toInt())
        // The capture payload is the canonical wrapped serialization.
        assertTrue((bySlot[5]!!["stack_yaml"] as String).startsWith("item:"))
    }

    @Test
    fun `unknown player answers player_not_found`() {
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(sink, latch)
        p.handleMessageForTesting("""{"type":"player_inventory_fetch","request_id":"r2","player":"Ghost"}""")
        await(latch)

        assertEquals(false, sink[0]["ok"])
        assertEquals("player_not_found", sink[0]["error"])
    }
}
