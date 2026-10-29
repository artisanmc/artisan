package net.artisanmc.plugin.hub

import java.io.File
import java.security.MessageDigest

/**
 * Packs built by the editor, named by their SHA-1; the last three stay served.
 * One store per kind: the Java pack (`/resource-pack/<sha1>.zip`) and the
 * Bedrock pack (`/bedrock-pack/<sha1>.mcpack`).
 */
class PackStore(private val dir: File, val path: String = PATH, private val extension: String = "zip") {
    private val name = Regex("[0-9a-f]{40}\\.$extension")

    /** The path the hub serves a pack at. */
    fun pathOf(hash: String) = "$path/$hash.$extension"

    fun put(zip: ByteArray): String {
        val hash = MessageDigest.getInstance("SHA-1").digest(zip).joinToString("") { "%02x".format(it) }
        dir.mkdirs()
        val target = File(dir, "$hash.$extension")
        if (!target.isFile) {
            val tmp = File(dir, "$hash.$extension.tmp")
            tmp.writeBytes(zip)
            if (!tmp.renameTo(target)) { tmp.copyTo(target, overwrite = true); tmp.delete() }
        }
        target.setLastModified(System.currentTimeMillis())
        dir.listFiles { f -> f.name.matches(name) }.orEmpty().sortedByDescending { it.lastModified() }.drop(KEEP).forEach { it.delete() }
        return hash
    }

    fun get(file: String): ByteArray? = file.takeIf { name.matches(it) }?.let { File(dir, it) }?.takeIf { it.isFile }?.readBytes()

    /** The SHA-1 of the packs served, newest first. */
    fun hashes(): List<String> =
        dir.listFiles { f -> f.name.matches(name) }.orEmpty().sortedByDescending { it.lastModified() }.map { it.name.removeSuffix(".$extension") }

    companion object {
        private const val KEEP = 3
        const val PATH = "/resource-pack"
        const val BEDROCK_PATH = "/bedrock-pack"
    }
}
