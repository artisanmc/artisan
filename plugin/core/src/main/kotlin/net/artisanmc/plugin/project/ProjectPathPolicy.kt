package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files

/** Private state never enters a generic content channel, even through an alias. */
object ProjectPathPolicy {
    fun isPrivate(path: String): Boolean {
        val parts = path.replace('\\', '/').lowercase().split('/')
        return parts.any { it.startsWith(".artisan-write-") } || parts.zipWithNext().any { (parent, child) -> parent == ".artisan" && child in setOf("drafts", "transactions", "bases") } ||
            parts.lastOrNull() in setOf("rename-operation.json", "copy-operation.json") && parts.dropLast(1).lastOrNull() == ".artisan"
    }

    fun valid(path: String): Boolean = path.isNotEmpty() && path.length <= 512 &&
        path.none { it.code < 32 || it == '\\' || it == ':' } && path.split('/').all {
            it.isNotEmpty() && it != "." && it != ".." && !it.endsWith('.') && !it.endsWith(' ') &&
                !it.substringBefore('.').matches(Regex("(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])"))
        }

    fun resolve(root: File, path: String): File {
        require(valid(path)) { "invalid_path" }
        val target = File(root, path)
        val base = root.canonicalFile.toPath()
        require(target.canonicalFile.toPath().startsWith(base)) { "invalid_path" }
        var cursor: File? = target
        while (cursor != null && cursor.absoluteFile != root.absoluteFile) {
            require(!Files.isSymbolicLink(cursor.toPath())) { "invalid_path" }
            cursor = cursor.parentFile
        }
        return target
    }
}
