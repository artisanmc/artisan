package net.artisanmc.plugin.assistant

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class ImportSourceWebSocketTest {
    private val mapper = ObjectMapper()

    private class FakeImportSourceAccess(
        private val listings: List<ImportSourceListing> = emptyList(),
        private val readResult: ImportReadResult = ImportReadResult.Success(emptyList()),
    ) : ImportSourceAccess {
        override fun listAll() = listings
        override fun read(selections: List<ImportSelection>) = readResult
    }

    private fun provider(importSources: ImportSourceAccess): SyncedMenuProvider =
        SyncedMenuProvider(
            roots = ProjectRoots(Files.createTempDirectory("artisan-projects-").toFile()),
            serverKey = "",
            wsUrl = "",
            logger = null,
            importSources = importSources,
        )

    private fun handle(provider: SyncedMenuProvider, raw: String) {
        val method = provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
        method.isAccessible = true
        method.invoke(provider, raw)
    }

    @Test
    fun `import_sources_list responds from the executor`() {
        val access = FakeImportSourceAccess(
            listings = listOf(
                ImportSourceListing(
                    "zmenu",
                    "zMenu",
                    listOf(ImportFileMeta("shop.yml", 12)),
                ),
            ),
        )
        val sent = LinkedBlockingQueue<String>()
        val provider = provider(access).also { it.setSendForTesting(sent::add) }

        try {
            handle(provider, """{"type":"import_sources_list","request_id":"r1"}""")

            val raw = sent.poll(2, TimeUnit.SECONDS)
            assertNotNull(raw)
            val json = mapper.readTree(raw)
            assertEquals("import_sources_list_result", json["type"].asText())
            assertEquals("r1", json["request_id"].asText())
            assertEquals(true, json["ok"].asBoolean())
            assertEquals("shop.yml", json["sources"][0]["files"][0]["path"].asText())
        } finally {
            provider.shutdown()
        }
    }

    @Test
    fun `import_sources_read converts selections and returns text files`() {
        var received: List<ImportSelection>? = null
        val access = object : ImportSourceAccess {
            override fun listAll() = emptyList<ImportSourceListing>()
            override fun read(selections: List<ImportSelection>): ImportReadResult {
                received = selections
                return ImportReadResult.Success(
                    listOf(ImportedTextFile("zmenu", "categories/shop.yml", "name: Shop\n")),
                )
            }
        }
        val sent = LinkedBlockingQueue<String>()
        val provider = provider(access).also { it.setSendForTesting(sent::add) }

        try {
            handle(
                provider,
                """{"type":"import_sources_read","request_id":"r2","selections":[{"source_id":"zmenu","paths":["categories/shop.yml"]}]}""",
            )

            val raw = sent.poll(2, TimeUnit.SECONDS)
            assertNotNull(raw)
            val json = mapper.readTree(raw)
            assertEquals(listOf(ImportSelection("zmenu", listOf("categories/shop.yml"))), received)
            assertEquals("import_sources_read_result", json["type"].asText())
            assertEquals("r2", json["request_id"].asText())
            assertEquals(true, json["ok"].asBoolean())
            assertEquals("zmenu", json["files"][0]["source_id"].asText())
            assertEquals("categories/shop.yml", json["files"][0]["path"].asText())
            assertEquals("name: Shop\n", json["files"][0]["content"].asText())
        } finally {
            provider.shutdown()
        }
    }

    @Test
    fun `import_sources_read returns the reader failure verbatim`() {
        val sent = LinkedBlockingQueue<String>()
        val provider = provider(
            FakeImportSourceAccess(
                readResult = ImportReadResult.Failure("invalid_path", "categories/../secret.yml"),
            ),
        ).also { it.setSendForTesting(sent::add) }

        try {
            handle(
                provider,
                """{"type":"import_sources_read","request_id":"r3","selections":[{"source_id":"zmenu","paths":["categories/../secret.yml"]}]}""",
            )

            val json = mapper.readTree(sent.poll(2, TimeUnit.SECONDS))
            assertEquals("r3", json["request_id"].asText())
            assertEquals(false, json["ok"].asBoolean())
            assertEquals("invalid_path", json["error"].asText())
            assertEquals("categories/../secret.yml", json["message"].asText())
        } finally {
            provider.shutdown()
        }
    }

    @Test
    fun `import_sources_read rejects malformed selections without calling the reader`() {
        val readCalls = AtomicInteger()
        val access = object : ImportSourceAccess {
            override fun listAll() = emptyList<ImportSourceListing>()
            override fun read(selections: List<ImportSelection>): ImportReadResult {
                readCalls.incrementAndGet()
                return ImportReadResult.Success(emptyList())
            }
        }
        val sent = LinkedBlockingQueue<String>()
        val provider = provider(access).also { it.setSendForTesting(sent::add) }

        try {
            handle(
                provider,
                """{"type":"import_sources_read","request_id":"bad","selections":[{"source_id":"zmenu","paths":[12]}]}""",
            )

            val json = mapper.readTree(sent.poll(2, TimeUnit.SECONDS))
            assertEquals(false, json["ok"].asBoolean())
            assertEquals("invalid_input", json["error"].asText())
            assertEquals(0, readCalls.get())
        } finally {
            provider.shutdown()
        }
    }

    @Test
    fun `import source disk access never blocks the websocket callback thread`() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val access = object : ImportSourceAccess {
            override fun listAll(): List<ImportSourceListing> {
                entered.countDown()
                release.await(2, TimeUnit.SECONDS)
                return emptyList()
            }

            override fun read(selections: List<ImportSelection>) = ImportReadResult.Success(emptyList())
        }
        val sent = LinkedBlockingQueue<String>()
        val provider = provider(access).also { it.setSendForTesting(sent::add) }

        try {
            val started = System.nanoTime()
            handle(provider, """{"type":"import_sources_list","request_id":"async"}""")
            val elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)

            assertTrue(elapsedMs < 500, "WS callback blocked for ${elapsedMs}ms")
            assertTrue(entered.await(2, TimeUnit.SECONDS), "reader was not scheduled")
            assertNull(sent.poll(50, TimeUnit.MILLISECONDS), "reply arrived before the blocking reader completed")
        } finally {
            release.countDown()
            val raw = sent.poll(2, TimeUnit.SECONDS)
            provider.shutdown()
            assertNotNull(raw)
        }
    }

    @Test
    fun `import source requests are dropped when the executor is stopped`() {
        val sent = LinkedBlockingQueue<String>()
        val provider = provider(FakeImportSourceAccess()).also { it.setSendForTesting(sent::add) }
        provider.shutdown()

        val started = System.nanoTime()
        handle(provider, """{"type":"import_sources_list","request_id":"stopped"}""")
        handle(provider, """{"type":"import_sources_read","request_id":"stopped-read","selections":[]}""")
        val elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)

        assertTrue(elapsedMs < 500, "stopped executor blocked for ${elapsedMs}ms")
        assertNull(sent.poll(100, TimeUnit.MILLISECONDS))
    }

    @Test
    fun `unexpected reader failure still returns exactly one read error`() {
        val access = object : ImportSourceAccess {
            override fun listAll() = emptyList<ImportSourceListing>()
            override fun read(selections: List<ImportSelection>): ImportReadResult = error("disk exploded")
        }
        val sent = LinkedBlockingQueue<String>()
        val provider = provider(access).also { it.setSendForTesting(sent::add) }

        try {
            handle(
                provider,
                """{"type":"import_sources_read","request_id":"boom","selections":[]}""",
            )

            val raw = sent.poll(2, TimeUnit.SECONDS)
            assertNotNull(raw)
            val json = mapper.readTree(raw)
            assertEquals(false, json["ok"].asBoolean())
            assertEquals("read_error", json["error"].asText())
            assertEquals("disk exploded", json["message"].asText())
            assertNull(sent.poll(100, TimeUnit.MILLISECONDS))
        } finally {
            provider.shutdown()
        }
    }
}
