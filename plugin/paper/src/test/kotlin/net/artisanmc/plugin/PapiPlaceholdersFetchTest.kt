package net.artisanmc.plugin

import net.artisanmc.plugin.scheduling.DispatchingScheduler
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PapiPlaceholdersFetchTest {
    @Test fun `retrieves the current catalog on the main thread and returns the request identity`() {
        val mainTasks = mutableListOf<() -> Unit>()
        val papi = object : PapiProvider() {
            override fun declaredPlaceholders() = PapiPlaceholderCatalog(listOf(PapiPlaceholder("%player_name%", "player")))
        }
        val deps = SoftDepRegistry(null, papi, null)
        val provider = SyncedMenuProvider(
            roots = ProjectRoots(Files.createTempDirectory("papi-fetch").toFile()),
            logger = null,
            evaluator = ConditionEvaluator(deps, CooldownStore()),
            scheduler = DispatchingScheduler { mainTasks.add(it) },
        )
        provider.load()
        val latch = CountDownLatch(1)
        var reply: Map<*, *>? = null
        provider.setSendForTesting { reply = ObjectMapper().readValue(it, Map::class.java); latch.countDown() }
        provider.handleMessageForTesting("""{"type":"papi_placeholders_fetch","request_id":"papi1"}""")
        assertNull(reply)
        mainTasks.forEach { it() }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertEquals("papi_placeholders_result", reply?.get("type"))
        assertEquals("papi1", reply?.get("request_id"))
        assertEquals(true, reply?.get("ok"))
        assertEquals(listOf(mapOf("placeholder" to "%player_name%", "expansion" to "player")), reply?.get("placeholders"))
    }

    @Test fun `missing PlaceholderAPI returns an empty catalog`() {
        val provider = SyncedMenuProvider(
            roots = ProjectRoots(Files.createTempDirectory("papi-absent").toFile()),
            logger = null,
        )
        provider.load()
        val latch = CountDownLatch(1)
        var reply: Map<*, *>? = null
        provider.setSendForTesting { reply = ObjectMapper().readValue(it, Map::class.java); latch.countDown() }
        provider.handleMessageForTesting("""{"type":"papi_placeholders_fetch","request_id":"absent"}""")
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertEquals(true, reply?.get("ok"))
        assertEquals(emptyList<Any>(), reply?.get("placeholders"))
    }
}
