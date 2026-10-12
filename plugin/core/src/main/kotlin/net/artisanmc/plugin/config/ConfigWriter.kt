package net.artisanmc.plugin.config

import java.io.File

object ConfigWriter {
    fun writeServerKey(configFile: File, serverKey: String) {
        val existing = if (configFile.exists()) configFile.readText() else ""
        val line = "server_key: \"$serverKey\""
        val updated = if (Regex("""^server_key:[^\r\n]*""", RegexOption.MULTILINE).containsMatchIn(existing)) {
            existing.replace(Regex("""^server_key:[^\r\n]*""", RegexOption.MULTILINE), line)
        } else {
            "$line\n$existing"
        }
        configFile.writeText(updated)
    }
}
