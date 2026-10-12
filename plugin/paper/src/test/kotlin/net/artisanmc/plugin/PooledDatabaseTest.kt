package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.DatabaseDialect
import net.artisanmc.plugin.database.PooledDatabase
import net.artisanmc.plugin.database.readDatabaseSettings
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
    private val db = PooledDatabase({ readDatabaseSettings(environment, config, dir) }, logger)

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() {
        db.closeAll()
        MockBukkit.unmock()
    }

    private fun yaml(text: String) = YamlConfiguration().apply { loadFromString(text) }

    @Test
    fun `one pool per plugin, closed when the plugin is disabled`() {
        val quests = MockBukkit.createMockPlugin("Quests")
        val guilds = MockBukkit.createMockPlugin("Guilds")
        assertNotSame(db.dataSource(quests), db.dataSource(guilds))
        assertEquals(DatabaseDialect.H2, db.dialect)

        val first = db.dataSource(quests)
        assertSame(first, db.dataSource(quests))
        db.onPluginDisable(PluginDisableEvent(quests))
        val second = db.dataSource(quests)
        assertNotSame(first, second)
        second.connection.use { assertTrue(it.isValid(1)) }
    }

    @Test
    fun `pool size comes from config yml`() {
        config.set("database.pool-size", 7)
        assertEquals(7, readDatabaseSettings(environment, config, dir).poolSize)
        config.set("database.pool-size", 500)
        assertEquals(50, readDatabaseSettings(environment, config, dir).poolSize)
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
        val s = readDatabaseSettings(environment, config, dir) { missing += it }
        assertEquals(DatabaseDialect.MARIADB, s.dialect)
        assertEquals("db.internal", s.host)
        assertEquals(3307, s.port)
        assertEquals("", s.password)
        assertEquals(listOf("ARTISAN_TEST_UNSET_PASSWORD"), missing)
        assertFalse(s.toString().contains("password"), "settings never print the password")
    }
}
