package net.artisanmc.plugin.config

import org.bukkit.configuration.file.YamlConfiguration
import java.io.File
import java.security.SecureRandom
import java.util.Base64

/**
 * Le secret qui relie le hub et ses feuilles, dans l'ordre : `web.secret`, le secret de
 * transfert Velocity que chaque serveur du réseau connaît déjà (`config/paper-global.yml`),
 * puis celui que le hub a généré dans [stored]. Vide si rien ne le donne.
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
