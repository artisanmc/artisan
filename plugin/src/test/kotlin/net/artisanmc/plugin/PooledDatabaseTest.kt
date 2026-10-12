package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.DatabaseDialect
import net.artisanmc.plugin.database.DatabaseSettings
import net.artisanmc.plugin.database.PooledDatabase
import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.event.server.PluginDisableEvent
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.*

class PooledDatabaseTest {
    private val dir = Files.createTempDirectory("artisan_db_").toFile()
    private val logger = Logger.getLogger("PooledDatabaseTest")
    private var environment = YamlConfiguration()
    private val config = YamlConfiguration()
    private val db = PooledDatabase({ DatabaseSettings.from(environment, config, dir) }, logger)

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() {
        db.closeAll()
        MockBukkit.unmock()
    }

    private fun yaml(text: String) = YamlConfiguration().apply { loadFromString(text) }

    @Test
    fun `defaults to one h2 database shared by the suite`() {
        val quests = MockBukkit.createMockPlugin("Quests")
        val guilds = MockBukkit.createMockPlugin("Guilds")

        db.dataSource(quests).connection.use { c ->
            c.createStatement().execute("CREATE TABLE artisan_servers (id INT PRIMARY KEY)")
            c.createStatement().execute("INSERT INTO artisan_servers VALUES (1)")
        }
        db.dataSource(guilds).connection.use { c ->
            c.createStatement().execute(
                "CREATE TABLE guilds_homes (server_id INT REFERENCES artisan_servers(id))",
            )
            c.createStatement().execute("INSERT INTO guilds_homes VALUES (1)")
        }
        assertNotSame(db.dataSource(quests), db.dataSource(guilds), "still one pool per plugin")
        assertEquals(DatabaseDialect.H2, db.dialect)
        assertEquals(
            listOf("${PooledDatabase.H2_FILE}.mv.db"),
            dir.resolve("database").listFiles()!!.map { it.name }.filter { it.endsWith(".mv.db") },
        )
    }

    @Test
    fun `same pool for the same plugin until it is disabled`() {
        val owner = MockBukkit.createMockPlugin("Boosts")
        val first = db.dataSource(owner)
        assertSame(first, db.dataSource(owner))

        db.onPluginDisable(PluginDisableEvent(owner))
        val second = db.dataSource(owner)
        assertNotSame(first, second)
        second.connection.use { assertTrue(it.isValid(1)) }
    }

    @Test
    fun `pool size comes from config yml`() {
        config.set("database.pool-size", 7)
        assertEquals(7, DatabaseSettings.from(environment, config, dir).poolSize)
        config.set("database.pool-size", 500)
        assertEquals(50, DatabaseSettings.from(environment, config, dir).poolSize)
    }

    @Test
    fun `reads credentials with environment variables resolved`() {
        environment = yaml(
            """
            database:
              type: "MariaDB"
              host: "db.internal"
              port: 3307
              name: "mc"
              user: "suite"
              password: "${'$'}{ARTISAN_TEST_UNSET_PASSWORD}"
            """.trimIndent(),
        )
        val missing = mutableListOf<String>()
        val s = DatabaseSettings.from(environment, config, dir) { missing += it }
        assertEquals(DatabaseDialect.MARIADB, s.dialect)
        assertEquals("db.internal", s.host)
        assertEquals(3307, s.port)
        assertEquals("", s.password)
        assertEquals(listOf("ARTISAN_TEST_UNSET_PASSWORD"), missing)
        assertFalse(s.toString().contains("password"), "settings never print the password")
    }

    @Test
    fun `unknown type fails with an explicit message`() {
        environment = yaml("database:\n  type: \"postgres\"\n")
        val owner = MockBukkit.createMockPlugin("Warps")
        val error = assertFailsWith<IllegalStateException> { db.dataSource(owner) }
        assertTrue(error.message!!.contains("postgres"))
        assertFailsWith<IllegalStateException> { db.dialect }
    }

    @Test
    fun `unreachable server fails with an explicit message`() {
        environment = yaml("database:\n  type: \"mysql\"\n  host: \"127.0.0.1\"\n  port: 1\n")
        val owner = MockBukkit.createMockPlugin("Lands")
        val error = assertFailsWith<IllegalStateException> { db.dataSource(owner) }
        assertTrue(error.message!!.contains("Lands"))
        assertTrue(error.message!!.contains("environment.yml"))
    }
}
