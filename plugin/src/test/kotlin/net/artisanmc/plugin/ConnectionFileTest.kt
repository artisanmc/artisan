package net.artisanmc.plugin

import net.artisanmc.plugin.config.ConnectionFile
import org.bukkit.configuration.file.YamlConfiguration
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ConnectionFileTest {
    private val dir = Files.createTempDirectory("artisan_conn_").toFile()
    private val config = dir.resolve("config.yml")
    private val connection = dir.resolve("connection.yml")

    @Test
    fun `moves server_key and ws_url out of config yml`() {
        config.writeText("# Language\nlanguage: \"fr\"\nserver_key: \"sk_abc\"\nws_url: \"ws://localhost:3001/ws/plugin\"\n")
        ConnectionFile.prepare(config, connection)

        val conn = YamlConfiguration.loadConfiguration(connection)
        assertEquals("sk_abc", conn.getString("server_key"))
        assertEquals("ws://localhost:3001/ws/plugin", conn.getString("ws_url"))
        val cfg = YamlConfiguration.loadConfiguration(config)
        assertFalse(cfg.contains("server_key"))
        assertFalse(cfg.contains("ws_url"))
        assertEquals("fr", cfg.getString("language"))
        assertTrue(config.readText().contains("# Language"), "comments kept")
    }

    @Test
    fun `existing connection yml wins over a stale config yml key`() {
        connection.writeText("server_key: \"sk_new\"\n")
        config.writeText("server_key: \"sk_old\"\nws_url: \"wss://x/ws/plugin\"\n")
        ConnectionFile.prepare(config, connection)

        val conn = YamlConfiguration.loadConfiguration(connection)
        assertEquals("sk_new", conn.getString("server_key"))
        assertEquals("wss://x/ws/plugin", conn.getString("ws_url"))
        assertFalse(YamlConfiguration.loadConfiguration(config).contains("server_key"))
    }

    @Test
    fun `fresh install gets a default connection yml`() {
        config.writeText("language: \"en\"\n")
        ConnectionFile.prepare(config, connection)

        val conn = YamlConfiguration.loadConfiguration(connection)
        assertEquals("", conn.getString("server_key"))
        assertEquals("wss://api.artisanmc.net/ws/plugin", conn.getString("ws_url"))
    }

    @Test
    fun `untouched when already split`() {
        connection.writeText("server_key: \"sk\"\nws_url: \"wss://y\"\n")
        config.writeText("language: \"en\"\n")
        val before = config.readText() to connection.readText()
        ConnectionFile.prepare(config, connection)
        assertEquals(before, config.readText() to connection.readText())
    }
}
