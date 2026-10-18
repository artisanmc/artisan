package net.artisanmc.plugin

import net.artisanmc.modules.api.database.DatabaseDialect
import net.artisanmc.plugin.database.ModuleDatabase
import org.bukkit.configuration.file.YamlConfiguration
import java.io.File
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.*

class ModuleDatabaseTest {
    private val plugins = Files.createTempDirectory("artisan_plugins_").toFile()
    private val quests = File(plugins, "Quests").apply { mkdirs() }
    private val artisanEnvironment = File(plugins, ModuleDatabase.ARTISAN_ENVIRONMENT)
    private val logger = Logger.getLogger("ModuleDatabaseTest")
    private val config = YamlConfiguration()
    private var saved = 0

    private fun resolve() = ModuleDatabase.resolve("Quests", quests, config, { saved++ }, artisanEnvironment, logger)

    private fun artisanFile(text: String) {
        artisanEnvironment.parentFile.mkdirs()
        artisanEnvironment.writeText(text)
    }

    @Test
    fun `Artisan's environment yml is read when it exists, and never written`() {
        artisanFile("database:\n  type: mariadb\n  host: db\n  name: suite\n  pool-size: 7\n")
        val before = artisanEnvironment.readText()
        val db = resolve()
        assertEquals(artisanEnvironment.path, db.source)
        assertEquals(DatabaseDialect.MARIADB, db.settings.dialect)
        assertEquals("db", db.settings.host)
        assertEquals("suite", db.settings.name)
        assertEquals(7, db.settings.poolSize)
        assertEquals(before, artisanEnvironment.readText())
        assertEquals(0, saved)
        assertNull(config.getConfigurationSection("database"))
    }

    @Test
    fun `without Artisan's file the plugin's own section is written with the defaults and used`() {
        val db = resolve()
        assertEquals("config.yml", db.source)
        assertEquals(1, saved)
        assertEquals("h2", config.getString("database.type"))
        assertEquals(3306, config.getInt("database.port"))
        assertEquals(4, config.getInt("database.pool-size"))
        assertEquals(DatabaseDialect.H2, db.settings.dialect)
        assertEquals(File(quests, "database"), db.settings.h2Dir)
        assertFalse(artisanEnvironment.exists())
    }

    @Test
    fun `a section the plugin already has is read as is`() {
        config.loadFromString("database:\n  type: mysql\n  host: own-db\n  user: quests\n")
        val db = resolve()
        assertEquals(0, saved)
        assertEquals(DatabaseDialect.MYSQL, db.settings.dialect)
        assertEquals("own-db", db.settings.host)
        assertEquals("quests", db.settings.user)
    }

    @Test
    fun `database own keeps the plugin's section over Artisan's file`() {
        artisanFile("database:\n  type: mariadb\n  host: db\n")
        config.loadFromString("database:\n  own: true\n  type: mysql\n  host: own-db\n")
        val db = resolve()
        assertEquals("config.yml", db.source)
        assertEquals("own-db", db.settings.host)
    }

    @Test
    fun `the pool opens an H2 file under the plugin's folder`() {
        val db = resolve()
        try {
            db.dataSource("Quests").connection.use { assertTrue(it.isValid(1)) }
            assertTrue(File(quests, "database").listFiles().orEmpty().any { it.name.startsWith("suite") })
        } finally {
            db.close()
        }
    }
}
