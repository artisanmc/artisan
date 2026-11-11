package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AiConversationRowsTest {
    private val dir = Files.createTempDirectory("artisan_ai_conversations_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("AiConversationRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = AiConversationRows(ds)

    @AfterTest fun teardown() = pools.closeAll()

    private val owner = UUID.randomUUID()
    private val at = Instant.parse("2026-10-30T10:00:00Z")
    private fun row(id: String, lastActive: Instant, events: String = "[]", history: String? = null) =
        AiConversationRows.Row(id, owner, "u-local.shop", "u-local", "menu", at, lastActive, 10, 2, events, history, history?.let { "key" })

    @Test
    fun `a conversation is written, replaced, listed without its body, then deleted`() {
        rows.save(row("a", at))
        val long = "x".repeat(200_000)
        rows.save(row("a", at.plusSeconds(60), """[{"type":"user","text":"menu"}]""", """["$long"]"""))
        rows.save(row("b", at.plusSeconds(30)))
        rows.save(row("c", at).copy(ownerId = UUID.randomUUID()))

        val loaded = rows.load("a")!!
        assertEquals(at, loaded.createdAt)
        assertEquals(at.plusSeconds(60), loaded.lastActive)
        assertEquals("""["$long"]""", loaded.history, "a long history fits")
        assertEquals("key", loaded.historyKey)
        assertEquals(listOf("a", "b"), rows.list(owner).map { it.id })
        assertEquals("", rows.list(owner).first().events)
        assertNull(rows.list(owner).first().history)

        rows.deleteIdle(at.plusSeconds(45))
        assertEquals(listOf("a"), rows.list(owner).map { it.id })
        rows.delete("a")
        assertNull(rows.load("a"))
    }
}
