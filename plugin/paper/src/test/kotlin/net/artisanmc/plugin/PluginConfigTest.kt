package net.artisanmc.plugin

import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.config.deriveHttpBaseUrl
import net.artisanmc.plugin.config.hubWebSocketUrl
import net.artisanmc.plugin.config.serverName
import org.bukkit.configuration.file.YamlConfiguration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PluginConfigTest {
    @Test
    fun `deriveHttpBaseUrl strips ws path and swaps scheme`() {
        assertEquals("http://hub:8765", deriveHttpBaseUrl("ws://hub:8765/ws/plugin"))
        assertEquals("http://localhost:3001", deriveHttpBaseUrl("ws://localhost:3001/ws/plugin"))
        assertEquals("https://host:8443", deriveHttpBaseUrl("wss://host:8443/ws/plugin"))
        assertEquals("", deriveHttpBaseUrl(""))
    }

    @Test
    fun `hub address gives the hub's plugin WebSocket`() {
        assertEquals("ws://10.0.0.5:8765/ws/plugin", hubWebSocketUrl("10.0.0.5"))
        assertEquals("ws://10.0.0.5:9000/ws/plugin", hubWebSocketUrl(" 10.0.0.5:9000 "))
        assertEquals("ws://hub:8765/ws/plugin", hubWebSocketUrl("http://hub:8765/"))
        assertEquals("wss://editor.example.com/ws/plugin", hubWebSocketUrl("https://editor.example.com"))
        assertEquals("wss://hub:8443/ws/plugin", hubWebSocketUrl("wss://hub:8443/ws/plugin"))
        assertEquals("ws://[::1]:8765/ws/plugin", hubWebSocketUrl("[::1]"))
        assertEquals("", hubWebSocketUrl(""))
    }

    @Test
    fun `a written name is kept as is or refused, never altered`() {
        assertEquals("survie", serverName("survie", "data"))
        assertEquals("Survie_2-b", serverName(" Survie_2-b ", "data"))
        assertNull(serverName("survie.1", "data"))
        assertNull(serverName("mon serveur", "data"))
        assertNull(serverName("local", "data"))
        assertNull(serverName("a".repeat(65), "data"))
    }

    @Test
    fun `an empty name falls back to the folder name, made valid`() {
        assertEquals("data", serverName("", "data"))
        assertEquals("my-server", serverName("", "my server"))
        assertEquals("Minecraft", serverName("", ""))
        assertEquals("local-", serverName("", "local"))
    }

    @Test
    fun `a server with a hub address is a leaf, named at the root of environment yml`() {
        val environment = YamlConfiguration()
        environment.loadFromString("""
            name: "survie"
            web:
              hub: "10.0.0.5"
        """.trimIndent())
        val web = PluginConfig.from(YamlConfiguration(), environment).web
        assertTrue(web.leaf)
        assertEquals("ws://10.0.0.5:8765/ws/plugin", web.hubUrl)
        assertEquals("survie", web.name)
        assertFalse(PluginConfig.from(YamlConfiguration(), YamlConfiguration()).web.leaf)
    }

    @Test
    fun `parses resource-pack delegate-to-dir when set`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            resource-pack:
              delegate-to-dir: "/srv/mc/plugins/Oraxen/pack"
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertEquals("/srv/mc/plugins/Oraxen/pack", cfg.resourcePack.delegateToDir)
    }

    @Test
    fun `resource-pack delegate-to-dir defaults to null when absent`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            resource-pack:
              enabled: true
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertNull(cfg.resourcePack.delegateToDir)
    }

    @Test
    fun `resource-pack delegate-to-dir parses empty string as null`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            resource-pack:
              enabled: true
              delegate-to-dir: ""
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertNull(cfg.resourcePack.delegateToDir)
    }
}
