package net.artisanmc.plugin

import net.artisanmc.plugin.scheduling.DispatchingScheduler
import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.DataSourceDeclaration
import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.modules.api.PlayerRequiredException
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class DataSourceFetchHandlerTest {
    private val mapper = ObjectMapper()
    private var mainThreadRuns = 0

    @BeforeEach fun setup() { MockBukkit.mock(); mainThreadRuns = 0 }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    /** Provider with a captured send + a counting synchronous "main thread". */
    private fun provider(registry: DataSourceRegistry?, sink: MutableList<Map<String, Any?>>, latch: CountDownLatch): SyncedMenuProvider {
        val dir = Files.createTempDirectory("artisan_dsf_").toFile()
        val p = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(dir), logger = null,
            dataSources = registry,
            scheduler = DispatchingScheduler { task -> mainThreadRuns++; task() },
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
        assertTrue(latch.await(5, TimeUnit.SECONDS), "no data_source_fetch_result sent within 5s")

    @Test
    fun `fetches with null player on the main thread and shapes filter-sort-limit`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            "shop:items",
            { player, _ ->
            assertNull(player)
            listOf(
                mapOf("id" to "bow", "cat" to "armes", "price" to 30),
                mapOf("id" to "sword", "cat" to "armes", "price" to 10),
                mapOf("id" to "bread", "cat" to "food", "price" to 1),
                mapOf("id" to "axe", "cat" to "armes", "price" to 20),
            )
        },
        ))
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r1","ref":"shop:items",
            "params":{},"filter":{"cat":"armes"},"sort":{"by":"price","direction":"asc"},"limit":2,"args":{}}""")
        await(latch)

        assertEquals(1, mainThreadRuns)
        val msg = sink[0]
        assertEquals("data_source_fetch_result", msg["type"])
        assertEquals("r1", msg["request_id"])
        assertEquals(true, msg["ok"])
        assertEquals(false, msg["truncated"])
        @Suppress("UNCHECKED_CAST")
        val rows = msg["rows"] as List<Map<String, Any?>>
        assertEquals(listOf("sword", "axe"), rows.map { it["id"] })
    }

    @Test
    fun `interpolates {arg} tokens in filter values from args`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            "quests:list",
            { _, _ ->
            listOf(mapOf("id" to "q1", "group" to "daily"), mapOf("id" to "q2", "group" to "weekly"))
        },
        ))
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r2","ref":"quests:list",
            "params":{},"filter":{"group":"{group}"},"sort":null,"limit":null,"args":{"group":"daily"}}""")
        await(latch)

        @Suppress("UNCHECKED_CAST")
        val rows = sink[0]["rows"] as List<Map<String, Any?>>
        assertEquals(listOf("q1"), rows.map { it["id"] })
    }

    @Test
    fun `truncates to 50 rows and flags truncated`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            "big:list",
            { _, _ ->
            (1..80).map { mapOf<String, Any?>("i" to it) }
        },
        ))
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r3","ref":"big:list",
            "params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        @Suppress("UNCHECKED_CAST")
        val rows = sink[0]["rows"] as List<Map<String, Any?>>
        assertEquals(50, rows.size)
        assertEquals(true, sink[0]["truncated"])
    }

    @Test
    fun `truncates further when payload exceeds 256 KB`() {
        val big = "x".repeat(20_000)
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            "huge:list",
            { _, _ ->
            (1..40).map { mapOf<String, Any?>("i" to it, "blob" to big) }
        },
        ))
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r4","ref":"huge:list",
            "params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        @Suppress("UNCHECKED_CAST")
        val rows = sink[0]["rows"] as List<Map<String, Any?>>
        assertTrue(rows.size < 40, "expected byte-budget truncation, got ${rows.size} rows")
        assertEquals(true, sink[0]["truncated"])
    }

    @Test
    fun `unknown ref answers unknown_source without touching the main thread`() {
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(DataSourceRegistry(), sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r5","ref":"ghost:x",
            "params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        assertEquals(0, mainThreadRuns)
        assertEquals(false, sink[0]["ok"])
        assertEquals("unknown_source", sink[0]["error"])
    }

    @Test
    fun `PlayerRequiredException maps to player_required, other exceptions to fetch_error`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration("me:stats", { _, _ -> throw PlayerRequiredException("needs a player") }))
        registry.register(DataSourceDeclaration("boom:x", { _, _ -> error("kaboom") }))
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(2)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r6","ref":"me:stats","params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r7","ref":"boom:x","params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        val byId = sink.associateBy { it["request_id"] }
        assertEquals("player_required", byId["r6"]!!["error"])
        assertEquals("needs a player", byId["r6"]!!["message"])
        assertEquals("fetch_error", byId["r7"]!!["error"])
        assertEquals("kaboom", byId["r7"]!!["message"])
    }

    @Test
    fun `null-message exception falls back to the exception type instead of null`() {
        // Reproduces the editor "Le module a échoué : ?" report: a fetcher that
        // throws an NPE (null message) in preview mode. The reply must carry a
        // non-null, diagnosable message (the exception's class name).
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration("npe:x", { _, _ -> throw NullPointerException() }))
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(registry, sink, latch)

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r9","ref":"npe:x","params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        assertEquals(false, sink[0]["ok"])
        assertEquals("fetch_error", sink[0]["error"])
        assertEquals("NullPointerException", sink[0]["message"])
    }

    @Test
    fun `main-thread scheduling failure still replies with fetch_error`() {
        val dir = Files.createTempDirectory("artisan_dsf_").toFile()
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration("shop:items", { _, _ -> emptyList() }))
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(dir), logger = null,
            dataSources = registry,
            scheduler = DispatchingScheduler { throw IllegalStateException("plugin disabled") },
        )
        p.load()
        p.setSendForTesting { raw ->
            @Suppress("UNCHECKED_CAST")
            sink.add(mapper.readValue(raw, Map::class.java) as Map<String, Any?>)
            latch.countDown()
        }

        p.handleMessageForTesting("""{"type":"data_source_fetch","request_id":"r8","ref":"shop:items","params":{},"filter":{},"sort":null,"limit":null,"args":{}}""")
        await(latch)

        assertEquals("data_source_fetch_result", sink[0]["type"])
        assertEquals("r8", sink[0]["request_id"])
        assertEquals(false, sink[0]["ok"])
        assertEquals("fetch_error", sink[0]["error"])
    }
}
