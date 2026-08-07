package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Who is connected, for the editor's player pickers (canvas "preview as", capture
 * panel). The editor used to ask an admin to type a name blind.
 */
class OnlinePlayersFetchTest {
    private val mapper = ObjectMapper()
    private lateinit var server: ServerMock

    @BeforeEach fun setup() { server = MockBukkit.mock() }
    @AfterEach fun teardown() = MockBukkit.unmock()

    private fun provider(sink: MutableList<Map<String, Any?>>, latch: CountDownLatch): SyncedMenuProvider {
        val dir = Files.createTempDirectory("artisan_players_").toFile()
        val p = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(dir), serverKey = "", wsUrl = "", logger = null,
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

    private fun fetch(): Map<String, Any?> {
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(1)
        val p = provider(sink, latch)
        p.handleMessageForTesting("""{"type":"online_players_fetch","request_id":"r1"}""")
        assertTrue(latch.await(5, TimeUnit.SECONDS), "no online_players_result sent within 5s")
        return sink[0]
    }

    @Test
    fun `answers with the connected players, sorted`() {
        server.addPlayer("zoe")
        server.addPlayer("Alice")
        server.addPlayer("iban_")

        val msg = fetch()

        assertEquals("online_players_result", msg["type"])
        assertEquals("r1", msg["request_id"])
        assertEquals(true, msg["ok"])
        // Sorted case-insensitively so the picker reads naturally.
        assertEquals(listOf("Alice", "iban_", "zoe"), msg["players"])
    }

    /** An empty server is a valid answer, not an error — the picker just has nothing to offer. */
    @Test
    fun `answers an empty list when nobody is connected`() {
        val msg = fetch()

        assertEquals(true, msg["ok"])
        assertEquals(emptyList<String>(), msg["players"])
    }

    @Test
    fun `echoes the request id so concurrent requests stay correlated`() {
        val sink = java.util.Collections.synchronizedList(mutableListOf<Map<String, Any?>>())
        val latch = CountDownLatch(2)
        val p = provider(sink, latch)

        p.handleMessageForTesting("""{"type":"online_players_fetch","request_id":"a"}""")
        p.handleMessageForTesting("""{"type":"online_players_fetch","request_id":"b"}""")
        assertTrue(latch.await(5, TimeUnit.SECONDS), "expected two results")

        assertEquals(listOf("a", "b"), sink.map { it["request_id"] }.sortedBy { it.toString() })
    }
}
