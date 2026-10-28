package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class McpGrantRowsTest {
    private val dir = Files.createTempDirectory("artisan_mcp_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("McpGrantRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = McpGrantRows(ds)
    private val player = UUID.randomUUID()
    private val t0 = Instant.parse("2026-10-25T12:00:00Z")

    @AfterTest fun teardown() = pools.closeAll()

    private fun grant(id: String = "00000000-0000-0000-0000-000000000001", code: String? = "c".repeat(64)) = McpGrantRow(
        id, "mcp_1", "Claude", player, "Iban", "survie", setOf("artisan.editor.view", "artisan.editor.edit"), t0, t0,
        code, "x".repeat(43), "https://claude.ai/cb", t0.plusSeconds(60), null, null, null, null,
    )

    @Test
    fun `a client is stored, counted, and purged once old and unused`() {
        rows.putClient(McpClientRow("mcp_1", "Claude", listOf("https://claude.ai/cb", "http://127.0.0.1/cb"), t0))
        rows.putClient(McpClientRow("mcp_2", "Other", listOf("https://x.example/cb"), t0))
        assertEquals(listOf("https://claude.ai/cb", "http://127.0.0.1/cb"), rows.client("mcp_1")!!.redirectUris)
        assertEquals(2, rows.countClients())
        rows.insert(grant())
        assertEquals(1, rows.purgeClients(t0.plusSeconds(1)))
        assertNull(rows.client("mcp_2"))
        assertEquals("Claude", rows.client("mcp_1")!!.name)
    }

    @Test
    fun `a code is traded once, then tokens are found by their hash`() {
        val pending = grant()
        rows.insert(pending)
        assertEquals(pending, rows.find("code_hash", "c".repeat(64)))
        val issued = pending.copy(codeHash = null, codeChallenge = null, codeExpiresAt = null,
            accessHash = "a".repeat(64), accessExpiresAt = t0.plusSeconds(3600), refreshHash = "r".repeat(64), refreshExpiresAt = t0.plusSeconds(86400))
        assertTrue(rows.replace(pending, issued))
        // The same code again: its hash moved, the replace finds nothing.
        assertFalse(rows.replace(pending, issued))
        assertNull(rows.find("code_hash", "c".repeat(64)))
        assertEquals(issued, rows.find("access_hash", "a".repeat(64)))
        assertEquals(issued, rows.find("refresh_hash", "r".repeat(64)))
        val rotated = issued.copy(refreshHash = "s".repeat(64))
        assertTrue(rows.replace(issued, rotated))
        assertFalse(rows.replace(issued, rotated))
    }

    @Test
    fun `permissions follow the issuing server, and a player's grants go with their view`() {
        rows.insert(grant())
        rows.insert(grant("00000000-0000-0000-0000-000000000002").copy(origin = "lobby"))
        rows.setPermissions(player, "survie", setOf("artisan.editor.view"))
        assertEquals(setOf("artisan.editor.view"), rows.grants(player).first { it.origin == "survie" }.permissions)
        assertEquals(1, rows.deletePlayer(player, "lobby"))
        assertEquals(1, rows.grants(player).size)
        rows.touch(rows.grants(player).single().id, t0.plusSeconds(5))
        assertEquals(t0.plusSeconds(5), rows.grants(player).single().lastUsedAt)
        rows.purge(t0.plusSeconds(61))
        assertTrue(rows.grants(player).isEmpty())
    }
}
