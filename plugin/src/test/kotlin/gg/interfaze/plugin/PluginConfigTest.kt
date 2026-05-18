package gg.interfaze.plugin

import gg.interfaze.plugin.config.PluginConfig
import org.bukkit.configuration.file.YamlConfiguration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PluginConfigTest {
    @Test
    fun `resource-pack defaults parsed correctly`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            server_key: ""
            ws_url: "ws://x"
            language: "en"
            per_player_language: false
            resource-pack:
              enabled: true
              prompt: "<gold>Pack</gold>"
              send-on-join: true
              send-delay-ticks: 20
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertTrue(cfg.resourcePack.enabled)
        assertEquals(20L, cfg.resourcePack.sendDelayTicks)
        assertTrue(cfg.resourcePack.sendOnJoin)
    }

    @Test
    fun `resource-pack missing block falls back to defaults`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("server_key: \"\"\nws_url: \"ws://x\"")
        val cfg = PluginConfig.from(yaml)
        assertTrue(cfg.resourcePack.enabled)
        assertEquals(20L, cfg.resourcePack.sendDelayTicks)
    }

    @Test
    fun `parses resource-pack delegate-to-dir when set`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            server_key: ""
            ws_url: "ws://x"
            resource-pack:
              enabled: true
              prompt: "<gold>x</gold>"
              send-on-join: true
              send-delay-ticks: 20
              delegate-to-dir: "/srv/mc/plugins/Oraxen/pack"
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertEquals("/srv/mc/plugins/Oraxen/pack", cfg.resourcePack.delegateToDir)
    }

    @Test
    fun `resource-pack delegate-to-dir defaults to null when absent`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            server_key: ""
            ws_url: "ws://x"
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
            server_key: ""
            ws_url: "ws://x"
            resource-pack:
              enabled: true
              delegate-to-dir: ""
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertNull(cfg.resourcePack.delegateToDir)
    }
}
