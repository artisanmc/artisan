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

class DraftRowsTest {
    private val dir = Files.createTempDirectory("artisan_drafts_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("DraftRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val server = ServerRegistry(ds, DatabaseDialect.H2, Logger.getAnonymousLogger()).let { reg ->
        UUID.randomUUID().also { reg.register(it, "survie", Instant.EPOCH) }.let { reg.rowId(it)!! }
    }
    private val drafts = DraftRows(ds)

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `a draft and its receipt are written together, and listed by project`() {
        drafts.commit(server, "key-1", "d1", "{\"v\":1}", "op-1", "f1", "{\"ok\":true}")
        drafts.commit(server, "key-1", "d1", "{\"v\":2}", "op-2", "f2", "{\"ok\":true,\"n\":2}")
        drafts.commit(server, "key-2", "d9", "{\"v\":9}", "op-3", "f3", "{}")
        assertEquals("{\"v\":2}", drafts.get(server, "key-1", "d1"))
        assertEquals(listOf("{\"v\":2}"), drafts.all(server, "key-1"))
        assertEquals("f2" to "{\"ok\":true,\"n\":2}", drafts.receipt("op-2"))
        assertNull(drafts.receipt("op-9"))
        drafts.commit(server, "key-1", "D1", "{\"v\":\"upper\"}", "op-4", "f4", "{}")
        assertEquals("{\"v\":2}", drafts.get(server, "key-1", "d1"))
    }

    @Test
    fun `contents are stored once by hash`() {
        val contents = ContentRows(ds)
        assertNull(contents.get("a".repeat(64)))
        contents.put("a".repeat(64), byteArrayOf(1, 2))
        contents.put("a".repeat(64), byteArrayOf(1, 2))
        assertEquals(listOf<Byte>(1, 2), contents.get("a".repeat(64))!!.toList())
    }
}
