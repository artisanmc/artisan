package net.artisanmc.plugin.hub

import java.io.File
import java.security.MessageDigest

/** Packs built by the editor, named by their SHA-1; the last three stay served. */
class PackStore(private val dir: File) {
    fun put(zip: ByteArray): String {
        val hash = MessageDigest.getInstance("SHA-1").digest(zip).joinToString("") { "%02x".format(it) }
        dir.mkdirs()
        val target = File(dir, "$hash.zip")
        if (!target.isFile) {
            val tmp = File(dir, "$hash.zip.tmp")
            tmp.writeBytes(zip)
            if (!tmp.renameTo(target)) { tmp.copyTo(target, overwrite = true); tmp.delete() }
        }
        target.setLastModified(System.currentTimeMillis())
        dir.listFiles { f -> f.name.matches(NAME) }.orEmpty().sortedByDescending { it.lastModified() }.drop(KEEP).forEach { it.delete() }
        return hash
    }

    fun get(name: String): ByteArray? = name.takeIf { NAME.matches(it) }?.let { File(dir, it) }?.takeIf { it.isFile }?.readBytes()

    companion object {
        private val NAME = Regex("[0-9a-f]{40}\\.zip")
        private const val KEEP = 3
        const val PATH = "/resource-pack"
    }
}
