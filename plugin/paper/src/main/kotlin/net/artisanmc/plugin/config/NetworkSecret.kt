package net.artisanmc.plugin.config

import org.bukkit.configuration.file.YamlConfiguration
import java.io.File
import java.security.SecureRandom
import java.util.Base64

/**
 * The secret linking the hub and its leaves, in order: `web.secret`, the Velocity
 * forwarding secret every server of the network already knows (`config/paper-global.yml`),
 * then the one the hub generated in [stored]. Empty if none of them provides it.
 */
object NetworkSecret {
    fun resolve(configured: String, serverRoot: File, stored: File, generate: Boolean): String {
        if (configured.isNotBlank()) return configured
        velocity(File(serverRoot, "config/paper-global.yml"))?.let { return it }
        if (stored.isFile) stored.readText().trim().takeIf { it.isNotEmpty() }?.let { return it }
        if (!generate) return ""
        val secret = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(SecureRandom()::nextBytes))
        stored.parentFile?.mkdirs()
        stored.writeText(secret)
        return secret
    }

    private fun velocity(file: File): String? {
        if (!file.isFile) return null
        val paper = YamlConfiguration.loadConfiguration(file)
        if (!paper.getBoolean("proxies.velocity.enabled")) return null
        return paper.getString("proxies.velocity.secret")?.takeIf { it.isNotBlank() }
    }
}
