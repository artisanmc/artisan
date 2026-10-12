package net.artisanmc.plugin

import net.artisanmc.plugin.config.EnvironmentFile
import org.bukkit.configuration.file.YamlConfiguration
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EnvironmentFileTest {
    private val dir = Files.createTempDirectory("artisan_env_").toFile()
    private val config = dir.resolve("config.yml")
    private val connection = dir.resolve("connection.yml")
    private val environment = dir.resolve("environment.yml")

    private fun prepare() = EnvironmentFile.prepare(config, connection, environment)

    @Test
    fun `moves server_key and ws_url out of config yml`() {
        config.writeText("# Language\nlanguage: \"fr\"\nserver_key: \"sk_abc\"\nws_url: \"ws://localhost:3001/ws/plugin\"\n")
        prepare()

        val env = YamlConfiguration.loadConfiguration(environment)
        assertEquals("sk_abc", env.getString("server_key"))
        assertEquals("ws://localhost:3001/ws/plugin", env.getString("ws_url"))
        val cfg = YamlConfiguration.loadConfiguration(config)
        assertFalse(cfg.contains("server_key"))
        assertFalse(cfg.contains("ws_url"))
        assertEquals("fr", cfg.getString("language"))
        assertTrue(config.readText().contains("# Language"), "comments kept")
    }

    @Test
    fun `migrates connection yml and removes it`() {
        connection.writeText("server_key: \"sk_conn\"\nws_url: \"wss://self.hosted/ws/plugin\"\n")
        config.writeText("language: \"en\"\n")
        prepare()

        val env = YamlConfiguration.loadConfiguration(environment)
        assertEquals("sk_conn", env.getString("server_key"))
        assertEquals("wss://self.hosted/ws/plugin", env.getString("ws_url"))
        assertEquals("h2", env.getString("database.type"))
        assertFalse(connection.exists())
    }

    @Test
    fun `existing environment yml wins over stale copies`() {
        environment.writeText("server_key: \"sk_new\"\nws_url: \"wss://x/ws/plugin\"\ndatabase:\n  type: \"mysql\"\n")
        connection.writeText("server_key: \"sk_conn\"\n")
        config.writeText("server_key: \"sk_old\"\n")
        val before = environment.readText()
        prepare()

        assertEquals(before, environment.readText(), "never rewritten once it exists")
        assertFalse(connection.exists())
        assertFalse(YamlConfiguration.loadConfiguration(config).contains("server_key"))
    }

    @Test
    fun `fresh install gets a default environment yml`() {
        config.writeText("language: \"en\"\n")
        prepare()

        val env = YamlConfiguration.loadConfiguration(environment)
        assertEquals("", env.getString("server_key"))
        assertEquals("wss://api.artisanmc.net/ws/plugin", env.getString("ws_url"))
        assertEquals("h2", env.getString("database.type"))
        assertEquals(3306, env.getInt("database.port"))
    }

    @Test
    fun `untouched when already migrated`() {
        environment.writeText("server_key: \"sk\"\nws_url: \"wss://y\"\n")
        config.writeText("language: \"en\"\n")
        val before = config.readText() to environment.readText()
        prepare()
        assertEquals(before, config.readText() to environment.readText())
    }

    @Test
    fun `resolves environment variables and reports unset ones`() {
        val env = mapOf("ARTISAN_DB_PASSWORD" to "s3cret")
        val missing = mutableListOf<String>()
        assertEquals(
            "s3cret/-",
            EnvironmentFile.resolve("\${ARTISAN_DB_PASSWORD}/\${UNSET}-", env::get) { missing += it },
        )
        assertEquals(listOf("UNSET"), missing)
        assertEquals("plain \$NOT_A_REF", EnvironmentFile.resolve("plain \$NOT_A_REF", env::get))
    }
}
