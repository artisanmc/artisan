package net.artisanmc.plugin

import net.artisanmc.plugin.config.EditableConfig
import org.bukkit.configuration.file.YamlConfiguration
import java.io.InputStreamReader
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EditableConfigTest {
    private val defaults = YamlConfiguration.loadConfiguration(
        InputStreamReader(javaClass.classLoader.getResourceAsStream("config.yml")!!),
    )
    private val editable = EditableConfig(defaults)
    private fun fileConfig(text: String = "") = YamlConfiguration().apply {
        loadFromString(text)
        setDefaults(this@EditableConfigTest.defaults)
    }

    @Test
    fun `reports every bundled leaf key and never the connection`() {
        val report = editable.report(fileConfig("language: \"fr\"\n"))
        assertEquals("fr", report["language"])
        assertEquals(true, report["resource-pack.enabled"])
        assertEquals("", report["resource-pack.container-textures.chest"])
        assertFalse("server_key" in report)
        assertFalse("ws_url" in report)
        assertFalse(report.keys.any { it.startsWith("editor.") || it.startsWith("assistant.") })
    }

    @Test
    fun `applies typed changes`() {
        val cfg = fileConfig()
        assertNull(editable.apply(cfg, mapOf(
            "language" to "fr",
            "resource-pack.send-delay-ticks" to 40,
            "resource-pack.container-textures.chest" to "ui:menu_items",
        )))
        assertEquals("fr", cfg.getString("language"))
        assertEquals(40L, cfg.getLong("resource-pack.send-delay-ticks"))
        assertEquals("ui:menu_items", cfg.getString("resource-pack.container-textures.chest"))
    }

    @Test
    fun `rejects the whole batch on one bad change`() {
        val cfg = fileConfig()
        val error = editable.apply(cfg, mapOf("language" to "fr", "server_key" to "sk_x"))
        assertEquals("server_key: unknown_key", error)
        assertEquals("en", cfg.getString("language"))
    }

    @Test
    fun `rejects wrong types and malformed texture refs`() {
        val cfg = fileConfig()
        assertEquals("resource-pack.enabled: invalid_type", editable.apply(cfg, mapOf("resource-pack.enabled" to "yes")))
        assertEquals("resource-pack.send-delay-ticks: invalid_type", editable.apply(cfg, mapOf("resource-pack.send-delay-ticks" to 1.5)))
        assertEquals("resource-pack.container-textures.hopper: invalid_reference", editable.apply(cfg, mapOf("resource-pack.container-textures.hopper" to "menu_items")))
    }

    @Test
    fun `paths stay under the server root`() {
        val cfg = fileConfig()
        for (bad in listOf("/etc", "C:\\Windows", "\\\\host\\share", "plugins/../../x", "..")) {
            assertEquals("resource-pack.delegate-to-dir: unsafe_path", editable.apply(cfg, mapOf("resource-pack.delegate-to-dir" to bad)), bad)
        }
        assertNull(editable.apply(cfg, mapOf("resource-pack.delegate-to-dir" to "plugins/Nexo/pack/external_packs/artisan.zip")))
        assertNull(editable.apply(cfg, mapOf("resource-pack.delegate-to-dir" to "")))
        assertTrue(cfg.getString("resource-pack.delegate-to-dir")!!.isEmpty())
    }
}
