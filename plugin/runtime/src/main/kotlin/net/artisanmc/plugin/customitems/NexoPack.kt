package net.artisanmc.plugin.customitems

import java.io.Closeable
import java.io.File
import java.util.zip.ZipFile

/**
 * Nexo's resource pack sources on disk: `plugins/Nexo/pack/`, then its `external_packs/`
 * (folders, then zips), the order Nexo merges them in. Read without the Nexo API.
 */
internal class NexoPack(nexoDir: File) {
    private val pack = File(nexoDir, "pack")

    /** One pass over the pack: the sources are listed and each zip opened once, however many files are read. */
    fun <T> use(block: (Lookup) -> T): T = Lookup().use(block)

    inner class Lookup : Closeable {
        private val external = File(pack, "external_packs").listFiles()?.sortedBy { it.name }.orEmpty()
        private val folders = listOf(pack) + external.filter { it.isDirectory }
        private val zips: List<ZipFile> by lazy {
            external.filter { it.isFile && it.extension == "zip" }.mapNotNull { runCatching { ZipFile(it) }.getOrNull() }
        }
        private var zipsOpened = false

        /** `ns:path` (bare path = `minecraft`) under `assets/<ns>/<kind>/`, with [ext]; a lazy reader, null when absent. */
        fun locate(kind: String, ref: String, ext: String): (() -> ByteArray)? {
            val ns = ref.substringBefore(':', "minecraft")
            val path = ref.substringAfter(':').removeSuffix(".$ext")
            val rel = "assets/$ns/$kind/$path.$ext"
            if (rel.split('/').any { it == ".." || it.isEmpty() }) return null
            folders.forEach { root ->
                val f = File(root, rel)
                if (f.isFile) return { f.readBytes() }
            }
            zipsOpened = true
            zips.forEach { zip ->
                val entry = zip.getEntry(rel)
                if (entry != null) return { zip.getInputStream(entry).use { it.readBytes() } }
            }
            return null
        }

        fun read(kind: String, ref: String, ext: String): ByteArray? = locate(kind, ref, ext)?.invoke()

        override fun close() {
            if (zipsOpened) zips.forEach { runCatching { it.close() } }
        }
    }
}
