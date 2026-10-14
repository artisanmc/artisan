package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class EditorSessionRowsTest {
    private val dir = Files.createTempDirectory("artisan_sessions_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("EditorSessionRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = EditorSessionRows(ds)
    private val player = UUID.randomUUID()
    private val t0 = Instant.parse("2026-10-14T12:00:00Z")

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `a session row is written, extended, then deleted`() {
        rows.put("k1", EditorSessionRow(player, "Iban", setOf("artisan.editor.view", "artisan.editor.edit"), t0))
        assertEquals(EditorSessionRow(player, "Iban", setOf("artisan.editor.view", "artisan.editor.edit"), t0), rows.get("k1"))
        rows.touch("k1", t0.plusSeconds(60))
        assertEquals(t0.plusSeconds(60), rows.get("k1")?.expiresAt)
        rows.delete("k1")
        assertNull(rows.get("k1"))
    }

    @Test
    fun `purge drops the expired rows only`() {
        rows.put("old", EditorSessionRow(player, "Iban", emptySet(), t0))
        rows.put("new", EditorSessionRow(player, "Iban", emptySet(), t0.plusSeconds(1)))
        rows.purge(t0)
        assertNull(rows.get("old"))
        assertEquals(emptySet(), rows.get("new")?.permissions)
    }
}
