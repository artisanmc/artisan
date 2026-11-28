package net.artisanmc.plugin.tree

import net.artisanmc.plugin.project.ContentHash
import net.artisanmc.plugin.project.FileOrigin
import net.artisanmc.plugin.project.ProjectOrigins
import net.artisanmc.plugin.project.ProjectPublisher
import net.artisanmc.plugin.project.ShippedIndex
import net.artisanmc.plugin.project.SystemFiles
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.model.DocumentLayout
import net.artisanmc.plugin.model.Originals
import net.artisanmc.plugin.model.YamlFiles
import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import java.nio.file.Files
import java.util.UUID

/**
 * A folder in the former layout (`originals/`) turned into one tree the owner edits, once, at
 * start (ADR `editable-module-tree`, "Migration"):
 * 1. the tree is [FlattenOriginals.flatten]ed;
 * 2. [ShippedIndex] is written from `.artisan/origins.yaml` and `originals/originals.yml`: every
 *    path the module shipped is indexed, copied or not (an absent one reads as deleted), against
 *    the version the owner's file was made from when it has one, else the shipped one;
 * 3. **the result is checked before anything is written**: both trees are loaded in a scratch
 *    folder and compared ([check]); a difference writes nothing and the folder keeps the former
 *    layout, still read as before, and is tried again at the next start;
 * 4. one journaled commit ([ProjectPublisher]): a Version, like a module update.
 *
 * `.artisan/origins.yaml` is kept, mirroring the index, so that an older Artisan started again
 * brings the folder back to its own layout (its sync removes the copies equal to their origin).
 */
object FolderMigration {
    sealed interface Result {
        /** The folder holds no `originals/`. */
        data object NotNeeded : Result
        data class Migrated(val written: List<String>, val removed: List<String>) : Result
        /** Nothing written: [reason] says what would have changed for players. */
        data class Refused(val reason: String) : Result
    }

    /** A check of the migration: null when [after] loads like [before], else what differs. */
    fun interface Check {
        fun compare(before: File, after: File): String?
    }

    private val TEMPLATE_MESSAGES = "messages"

    fun run(
        dir: File,
        check: Check = ReaderCheck,
        kindDirs: Set<String> = DocumentKinds.all().map { it.dir }.toSet(),
    ): Result {
        val files = contentFiles(dir)
        if (!FlattenOriginals.needed(files.keys)) return Result.NotNeeded
        val flat = FlattenOriginals.flatten(files, kindDirs)
        val index = indexFor(dir, files, flat)
        val withIndex = flat + (ShippedIndex.PATH to ShippedIndex.serialize(index))

        val reason = verify(dir.name, files, withIndex, check)
        if (reason != null) return Result.Refused(reason)

        val changes = linkedMapOf<String, ByteArray?>()
        for ((path, bytes) in withIndex) if (!files[path].contentEquals(bytes)) changes[path] = bytes
        for (path in files.keys) if (path !in withIndex) changes[path] = null
        // Every indexed YAML file's shipped content is the base of its next merge.
        val bases = File(dir, SystemFiles.BASES)
        for ((path, entry) in index) {
            if (!YamlFiles.isYaml(path) || File(bases, entry.hash).isFile) continue
            val shipped = files["${Originals.DIR}/$path"] ?: continue
            if (ContentHash.hashBytes(shipped) == entry.hash) changes["${SystemFiles.BASES}/${entry.hash}"] = shipped
        }
        // The origins mirror the index; those of `originals/…` paths go with the folder.
        val origins = ProjectOrigins.read(dir).filterKeys { !Originals.isOriginal(it) } + index.mapValues { it.value.origin }
        changes[ProjectOrigins.PATH] = ProjectOrigins.serialize(origins)
        ProjectPublisher(dir).commit(
            "migrate-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        // Empty folders left by `originals/`.
        File(dir, Originals.DIR).takeIf { it.isDirectory }?.let { root ->
            root.walkBottomUp().filter { it.isDirectory && it.list().isNullOrEmpty() }.forEach { it.delete() }
        }
        val (removed, written) = changes.keys.filter { !it.startsWith(".artisan") }.partition { changes[it] == null }
        return Result.Migrated(written, removed)
    }

    /** Every file of [dir] but Artisan's metadata (`.artisan*` first segment), by relative path. */
    fun contentFiles(dir: File): Map<String, ByteArray> {
        if (!dir.isDirectory) return emptyMap()
        val out = sortedMapOf<String, ByteArray>()
        dir.walkTopDown()
            .onEnter { it == dir || !(it.parentFile == dir && it.name.startsWith(".artisan")) }
            .filter { it.isFile }
            .forEach { f ->
                val rel = f.relativeTo(dir).invariantSeparatorsPath
                if (!rel.substringBefore('/').startsWith(".artisan")) out[rel] = f.readBytes()
            }
        return out
    }

    /**
     * One entry per shipped path: the origin of the owner's file when it has one, else what
     * `originals/` held (a file with no origin there, the messages `ShippedLang` wrote, gets one
     * from the index's module).
     */
    private fun indexFor(dir: File, files: Map<String, ByteArray>, flat: Map<String, ByteArray>): Map<String, ShippedIndex.Entry> {
        val origins = ProjectOrigins.read(dir)
        val former = Originals.parseIndex(files[Originals.INDEX_PATH]?.toString(Charsets.UTF_8))
        val required = former.required.mapTo(HashSet(), DocumentLayout::sameFile)
        val module = former.module.ifEmpty { origins.values.firstOrNull()?.module.orEmpty() }.ifEmpty { dir.name }
        val out = sortedMapOf<String, ShippedIndex.Entry>()
        for ((original, bytes) in files) {
            if (!Originals.isOriginal(original) || original == Originals.INDEX_PATH) continue
            val path = original.removePrefix("${Originals.DIR}/")
            val shippedOrigin = origins[original] ?: FileOrigin(module, TEMPLATE_MESSAGES, 1, ContentHash.hashBytes(bytes))
            // The owner's file at that path, as the flattened tree holds it (a merged lang file is new).
            val ownPath = flat.keys.firstOrNull { DocumentLayout.sameFile(it) == DocumentLayout.sameFile(path) }
            val ownOrigin = ownPath?.let { origins[it] }?.takeIf { files[ownPath] != null && files[ownPath].contentEquals(flat[ownPath]) }
            val origin = ownOrigin ?: shippedOrigin
            out[ownPath ?: path] = ShippedIndex.Entry.of(origin, DocumentLayout.sameFile(path) in required)
        }
        return out
    }

    /** Both trees written to a scratch folder and compared by [check]; null when they load alike. */
    private fun verify(name: String, before: Map<String, ByteArray>, after: Map<String, ByteArray>, check: Check): String? {
        val scratch = Files.createTempDirectory("artisan-migrate").toFile()
        return try {
            val b = File(File(scratch, "before"), name).also { write(it, before) }
            val a = File(File(scratch, "after"), name).also { write(it, after) }
            runCatching { check.compare(b, a) }.getOrElse { "the check failed: ${it.message}" }
        } finally {
            scratch.deleteRecursively()
        }
    }

    private fun write(dir: File, files: Map<String, ByteArray>) {
        for ((path, bytes) in files) File(dir, path).apply { parentFile.mkdirs(); writeBytes(bytes) }
    }

    /**
     * The server's own reading of both folders ([ProjectReader]): menus, dialogs, commands,
     * messages, data sources and models, variants and their rules must be equal.
     */
    object ReaderCheck : Check {
        override fun compare(before: File, after: File): String? {
            val b = ProjectReader(before.parentFile).readAll()
            val a = ProjectReader(after.parentFile).readAll()
            if (b == a) return null
            val pb = b.firstOrNull(); val pa = a.firstOrNull()
            if (pb == null || pa == null) return "the folder loads in one layout only"
            return listOfNotNull(
                "documents".takeIf { pb.documents != pa.documents },
                "messages".takeIf { pb.langMaps != pa.langMaps },
                "data sources".takeIf { pb.dataSources != pa.dataSources },
                "variants".takeIf { pb.variants != pa.variants },
                "variant rules".takeIf { pb.variantRules != pa.variantRules },
            ).ifEmpty { listOf("the project") }.joinToString(prefix = "would change: ")
        }
    }
}
