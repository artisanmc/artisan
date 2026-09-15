package net.artisanmc.plugin

import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.config.ImportSourceConfig
import net.artisanmc.plugin.config.deriveHttpBaseUrl
import org.bukkit.configuration.file.YamlConfiguration
import java.io.InputStreamReader
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PluginConfigTest {
    @Test
    fun `console access is opt in and unknown modes keep invitations`() {
        val yaml = YamlConfiguration()
        assertEquals("invitation", PluginConfig.from(yaml).editorAccessMode)
        yaml.set("editor.access_mode", "console")
        assertEquals("console", PluginConfig.from(yaml).editorAccessMode)
        yaml.set("editor.access_mode", "unknown")
        assertEquals("invitation", PluginConfig.from(yaml).editorAccessMode)
    }

    @Test
    fun `assistant import sources parse named roots`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            assistant:
              import-sources:
                zmenu:
                  enabled: true
                  label: "zMenu"
                  path: "plugins/zMenu/menus"
                  extensions: ["....YML", "yaml"]
                deluxe-menus:
                  enabled: true
                  label: "DeluxeMenus"
                  path: "plugins/DeluxeMenus/gui_menus"
                  extensions: [" yml "]
                hidden:
                  enabled: false
                  label: "Hidden"
                  path: "plugins/Hidden"
                  extensions: [".yml"]
        """.trimIndent())

        assertEquals(
            listOf(
                ImportSourceConfig(
                    id = "deluxe-menus",
                    label = "DeluxeMenus",
                    path = "plugins/DeluxeMenus/gui_menus",
                    extensions = setOf(".yml"),
                ),
                ImportSourceConfig(
                    id = "zmenu",
                    label = "zMenu",
                    path = "plugins/zMenu/menus",
                    extensions = setOf(".yml", ".yaml"),
                ),
            ),
            PluginConfig.from(yaml).assistantImportSources,
        )
    }

    @Test
    fun `unsafe assistant import sources are skipped with one warning each`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("""
            assistant:
              import-sources:
                BadId:
                  path: "plugins/Escape"
                  extensions: [".yml"]
                blank-path:
                  path: "   "
                  extensions: [".yml"]
                no-extensions:
                  path: "plugins/NoExtensions"
                  extensions: []
        """.trimIndent())

        val parsed = PluginConfig.from(yaml)

        assertEquals(emptyList(), parsed.assistantImportSources)
        assertEquals(3, parsed.assistantImportSourceWarnings.size)
        assertTrue(parsed.assistantImportSourceWarnings.any { it.contains("BadId") })
        assertTrue(parsed.assistantImportSourceWarnings.any { it.contains("blank-path") })
        assertTrue(parsed.assistantImportSourceWarnings.any { it.contains("no-extensions") })
    }

    @Test
    fun `absent assistant import source section stays empty`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("server_key: \"\"")

        val parsed = PluginConfig.from(yaml)

        assertEquals(emptyList(), parsed.assistantImportSources)
        assertEquals(emptyList(), parsed.assistantImportSourceWarnings)
    }

    @Test
    fun `legacy user config does not inherit assistant import sources from bundled defaults`() {
        val defaults = InputStreamReader(
            requireNotNull(javaClass.classLoader.getResourceAsStream("config.yml")),
            Charsets.UTF_8,
        ).use(YamlConfiguration::loadConfiguration)
        val userConfig = YamlConfiguration().apply {
            loadFromString("server_key: legacy-server")
            setDefaults(defaults)
            options().copyDefaults(true)
        }

        val parsed = PluginConfig.from(userConfig)

        assertEquals(emptyList(), parsed.assistantImportSources)
        assertEquals(emptyList(), parsed.assistantImportSourceWarnings)
    }

    @Test
    fun `deriveHttpBaseUrl strips ws path and swaps scheme`() {
        assertEquals("https://editor.artisanmc.net", deriveHttpBaseUrl("wss://editor.artisanmc.net/ws/plugin"))
        assertEquals("http://localhost:3001", deriveHttpBaseUrl("ws://localhost:3001/ws/plugin"))
        assertEquals("https://host:8443", deriveHttpBaseUrl("wss://host:8443/ws/plugin"))
        assertEquals("", deriveHttpBaseUrl(""))
    }

    @Test
    fun `httpBaseUrl derived from ws_url on the config`() {
        val yaml = YamlConfiguration()
        yaml.loadFromString("server_key: \"\"\nws_url: \"wss://editor.artisanmc.net/ws/plugin\"")
        assertEquals("https://editor.artisanmc.net", PluginConfig.from(yaml).httpBaseUrl)
    }

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
              delegate-to-dir: "/srv/mc/plugins/Oraxen/project"
        """.trimIndent())
        val cfg = PluginConfig.from(yaml)
        assertEquals("/srv/mc/plugins/Oraxen/project", cfg.resourcePack.delegateToDir)
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
