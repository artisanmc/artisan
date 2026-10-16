package net.artisanmc.plugin

import net.artisanmc.plugin.scheduling.DispatchingScheduler
import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.render.menu.HeadApplier
import org.bukkit.Material
import org.bukkit.inventory.ItemStack
import me.arcaniax.hdb.api.HeadDatabaseAPI
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import net.artisanmc.plugin.integrations.HeadDatabaseRenderer
import net.artisanmc.plugin.integrations.SoftDepRegistry

class HeadTextureFetchTest {
    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() { HeadDatabaseAPI.heads.clear(); MockBukkit.unmock() }

    @Test fun `returns the real HDB profile texture and reports unknown ids`() {
        val skin = "eyJ0ZXh0dXJlcyI6e319"
        HeadDatabaseAPI.heads["128276"] = HeadApplier.apply(ItemStack(Material.PLAYER_HEAD), "basehead:$skin", SoftDepRegistry.EMPTY)
        val deps = SoftDepRegistry(null, null, null, hdbHeads = HeadDatabaseRenderer())
        val mapper = ObjectMapper()
        val replies = java.util.Collections.synchronizedList(mutableListOf<Map<*, *>>())
        val latch = CountDownLatch(2)
        val mainTasks = mutableListOf<() -> Unit>()
        val provider = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(Files.createTempDirectory("head-preview").toFile()),
            logger = null,
            evaluator = ConditionEvaluator(deps, CooldownStore()),
            scheduler = DispatchingScheduler { mainTasks.add(it) },
        )
        provider.load()
        provider.setSendForTesting { raw -> replies.add(mapper.readValue(raw, Map::class.java)); latch.countDown() }
        for (id in listOf("128276", "999")) {
            provider.handleMessageForTesting("""{"type":"head_texture_fetch","request_id":"$id","id":"$id"}""")
        }
        assertTrue(replies.isEmpty(), "Bukkit access must be dispatched to the main thread")
        mainTasks.forEach { it() }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        val success = replies.first { it["request_id"] == "128276" }
        assertEquals(true, success["ok"])
        assertEquals(skin, success["texture"])
        assertEquals("head_not_found", replies.first { it["request_id"] == "999" }["error"])
    }

    @Test fun `missing HDB replies without blocking the editor`() {
        val mapper = ObjectMapper()
        val latch = CountDownLatch(1)
        var reply: Map<*, *>? = null
        val provider = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(Files.createTempDirectory("head-preview").toFile()),
            logger = null,
        )
        provider.load()
        provider.setSendForTesting { raw ->
            reply = mapper.readValue(raw, Map::class.java)
            latch.countDown()
        }
        provider.handleMessageForTesting("""{"type":"head_texture_fetch","request_id":"head1","id":"128276"}""")
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertEquals("head_texture_result", reply?.get("type"))
        assertEquals("head1", reply?.get("request_id"))
        assertEquals("hdb_unavailable", reply?.get("error"))
        assertEquals(false, reply?.get("ok"))
    }
}
