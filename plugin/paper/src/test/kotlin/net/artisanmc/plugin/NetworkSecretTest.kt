package net.artisanmc.plugin

import net.artisanmc.plugin.config.NetworkSecret
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NetworkSecretTest {
    private val root = Files.createTempDirectory("artisan_secret_").toFile()
    private val stored = root.resolve("plugins/Artisan/network-secret")

    private fun velocity(enabled: Boolean) {
        root.resolve("config").mkdirs()
        root.resolve("config/paper-global.yml").writeText("proxies:\n  velocity:\n    enabled: $enabled\n    secret: \"from-velocity\"\n")
    }

    @Test
    fun `web secret comes first`() {
        velocity(true)
        assertEquals("mine", NetworkSecret.resolve("mine", root, stored, generate = true))
    }

    @Test
    fun `the velocity secret is shared by every server of the network`() {
        velocity(true)
        assertEquals("from-velocity", NetworkSecret.resolve("", root, stored, generate = true))
        velocity(false)
        assertEquals("", NetworkSecret.resolve("", root, stored, generate = false))
    }

    @Test
    fun `the hub generates a secret once and keeps it`() {
        val first = NetworkSecret.resolve("", root, stored, generate = true)
        assertTrue(first.length >= 40)
        assertEquals(first, stored.readText())
        assertEquals(first, NetworkSecret.resolve("", root, stored, generate = true))
        assertEquals(first, NetworkSecret.resolve("", root, stored, generate = false))
    }
}
