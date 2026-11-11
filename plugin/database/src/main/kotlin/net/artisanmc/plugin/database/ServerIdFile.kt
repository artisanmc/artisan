package net.artisanmc.plugin.database

import java.io.File
import java.util.UUID

/** The server's identity: a UUID written once in `plugins/Artisan/server-id`, kept across renames. */
object ServerIdFile {
    fun read(file: File): UUID {
        file.takeIf { it.isFile }?.readText()?.trim()?.let { text -> runCatching { UUID.fromString(text) }.getOrNull() }?.let { return it }
        return UUID.randomUUID().also {
            file.parentFile?.mkdirs()
            file.writeText("$it\n")
        }
    }
}
