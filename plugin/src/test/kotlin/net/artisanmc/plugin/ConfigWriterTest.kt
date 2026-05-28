package net.artisanmc.plugin

import net.artisanmc.plugin.config.ConfigWriter
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConfigWriterTest {

    private fun tmpFile(content: String): File {
        val f = Files.createTempFile("artisan_cfg_", ".yml").toFile()
        f.writeText(content)
        return f
    }

    @Test
    fun `replaces existing empty server_key`() {
        val f = tmpFile("server_key: \"\"\nws_url: \"wss://example.com\"\n")
        ConfigWriter.writeServerKey(f, "sk_abc123")
        val result = f.readText()
        assertTrue(result.contains("server_key: \"sk_abc123\""), "Got: $result")
        assertTrue(result.contains("ws_url:"), "ws_url should be preserved")
    }

    @Test
    fun `replaces existing non-empty server_key`() {
        val f = tmpFile("server_key: \"sk_old\"\nws_url: \"wss://example.com\"\n")
        ConfigWriter.writeServerKey(f, "sk_new")
        assertTrue(f.readText().contains("server_key: \"sk_new\""))
    }

    @Test
    fun `appends server_key when line absent`() {
        val f = tmpFile("ws_url: \"wss://example.com\"\n")
        ConfigWriter.writeServerKey(f, "sk_abc")
        assertTrue(f.readText().contains("server_key: \"sk_abc\""))
    }

    @Test
    fun `creates content when file does not exist`() {
        val f = Files.createTempDirectory("artisan_").resolve("config.yml").toFile()
        ConfigWriter.writeServerKey(f, "sk_new")
        assertTrue(f.readText().contains("server_key: \"sk_new\""))
    }
}
