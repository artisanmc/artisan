package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotSame
import kotlin.test.assertSame
import kotlin.test.assertTrue

class ConnectionPoolsTest {
    private val dir = Files.createTempDirectory("artisan_db_").toFile()
    private var settings = settings("h2")
    private val pools = ConnectionPools({ settings }, Logger.getLogger("ConnectionPoolsTest"))

    @AfterTest fun teardown() = pools.closeAll()

    private fun settings(type: String, host: String = "localhost", port: String = "3306") =
        DatabaseSettings.of(type, host, port, "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir)

    @Test
    fun `defaults to one h2 database shared by the suite`() {
        pools.dataSource("Quests").connection.use { c ->
            c.createStatement().execute("CREATE TABLE artisan_servers (id INT PRIMARY KEY)")
            c.createStatement().execute("INSERT INTO artisan_servers VALUES (1)")
        }
        pools.dataSource("Guilds").connection.use { c ->
            c.createStatement().execute("CREATE TABLE guilds_homes (server_id INT REFERENCES artisan_servers(id))")
            c.createStatement().execute("INSERT INTO guilds_homes VALUES (1)")
        }
        assertNotSame(pools.dataSource("Quests"), pools.dataSource("Guilds"), "still one pool per plugin")
        assertEquals(DatabaseDialect.H2, pools.dialect)
        assertEquals(
            listOf("${ConnectionPools.H2_FILE}.mv.db"),
            dir.resolve("database").listFiles()!!.map { it.name }.filter { it.endsWith(".mv.db") },
        )
    }

    @Test
    fun `same pool for the same owner until it is closed`() {
        val first = pools.dataSource("Boosts")
        assertSame(first, pools.dataSource("Boosts"))

        pools.close("Boosts")
        val second = pools.dataSource("Boosts")
        assertNotSame(first, second)
        second.connection.use { assertTrue(it.isValid(1)) }
    }

    @Test
    fun `settings normalize the type and clamp the pool size`() {
        val s = DatabaseSettings.of(" MariaDB ", "db.internal", "3307", "mc", "suite", "secret", 500, dir)
        assertEquals(DatabaseDialect.MARIADB, s.dialect)
        assertEquals("mariadb", s.type)
        assertEquals(3307, s.port)
        assertEquals(50, s.poolSize)
        assertEquals(3306, settings("mysql", port = "not-a-port").port)
        assertTrue("secret" !in s.toString(), "settings never print the password")
    }

    @Test
    fun `unknown type fails with an explicit message`() {
        settings = settings("postgres")
        val error = assertFailsWith<IllegalStateException> { pools.dataSource("Warps") }
        assertTrue(error.message!!.contains("postgres"))
        assertFailsWith<IllegalStateException> { pools.dialect }
    }

    @Test
    fun `unreachable server fails with an explicit message`() {
        settings = settings("mysql", host = "127.0.0.1", port = "1")
        val error = assertFailsWith<IllegalStateException> { pools.dataSource("Lands") }
        assertTrue(error.message!!.contains("Lands"))
        assertTrue(error.message!!.contains("environment.yml"))
    }
}
