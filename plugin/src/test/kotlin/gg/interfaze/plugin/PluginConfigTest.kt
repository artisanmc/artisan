package gg.interfaze.plugin

import gg.interfaze.plugin.config.PluginConfig
import org.bukkit.configuration.file.YamlConfiguration
import kotlin.test.Test
import kotlin.test.assertEquals
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
}
