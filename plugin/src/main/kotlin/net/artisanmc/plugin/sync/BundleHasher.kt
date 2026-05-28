package net.artisanmc.plugin.sync

import java.io.File
import java.security.MessageDigest

object BundleHasher {

    fun hash(packDir: File): String {
        val sb = StringBuilder()
        packDir.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".artisan") }
            .sortedBy { it.relativeTo(packDir).path.replace('\\', '/') }
            .forEach { file ->
                val relPath = file.relativeTo(packDir).path.replace('\\', '/')
                sb.append(relPath).append('\n')
                sb.append(file.readText(Charsets.UTF_8)).append('\n')
            }
        if (sb.isEmpty()) return ""
        return sha256(sb.toString())
    }

    fun hashAll(packsDir: File): String {
        val packDirs = packsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }
            ?.sortedBy { it.name } ?: return ""
        if (packDirs.isEmpty()) return ""
        val sb = StringBuilder()
        packDirs.forEach { packDir ->
            sb.append(packDir.name).append(':').append(hash(packDir)).append('\n')
        }
        return sha256(sb.toString())
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
