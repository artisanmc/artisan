package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.model.DocumentLayout
import net.artisanmc.plugin.model.ManifestYaml
import net.artisanmc.plugin.model.ModuleFile
import net.artisanmc.plugin.model.YamlFiles
import net.artisanmc.plugin.yamlio.Yaml12
import java.io.File
import java.util.UUID

/**
 * What a module ships, kept in a folder that holds its whole tree (ADR `editable-module-tree`,
 * decisions 3 and 4). Each shipped file sits at its own path and is the owner's; [ShippedIndex]
 * says what it was written from. At each sync, by the file's state:
 * - **untouched** (the shipped content it was written from: same bytes, or for YAML the same
 *   value and no comment the shipped file lacks) → the new shipped content;
 * - **modified** → three-way merge ([SystemFiles.merge], base in [SystemFiles.BASES]), written
 *   only when it changes a value; with conflicts the owner's values stay and the index stays on
 *   the old version ("update available"); not YAML or no base: left alone, same signal;
 * - **deleted** (indexed, absent, no Document of the same identity elsewhere) → not written
 *   again and listed in `originals.exclude`; a **required** one is written again ([onRestored]);
 * - **no longer shipped** → removed when untouched, left to the owner otherwise;
 * - **new** → written, unless a file is already there: then it is the owner's, indexed against
 *   the shipped version so that the next update compares it.
 * The index and `.artisan/origins.yaml` (its mirror, read by an older Artisan) are written in
 * the same journaled commit as the files.
 */
internal object TreeSync {
    private val yaml = ObjectMapper(Yaml12.factory()).registerKotlinModule()

    fun sync(
        projectDir: File,
        moduleId: String,
        template: TemplateDeclaration,
        required: Boolean,
        onMerged: (path: String, conflicts: List<String>) -> Unit,
        onRestored: (path: String) -> Unit,
    ): List<String> {
        val index = ShippedIndex.read(projectDir).toMutableMap()
        val before = index.toMap()
        val changes = linkedMapOf<String, ByteArray?>()
        val merged = linkedMapOf<String, List<String>>()
        val restored = ArrayList<String>()
        val excludeNow = ArrayList<String>()
        val ours = { e: ShippedIndex.Entry? -> e?.takeIf { it.module == moduleId && it.template == template.id } }
        val excluded = manifestExclusions(projectDir)
        val layout by lazy { folderLayout(projectDir) }
        val shippedPaths = HashSet<String>()

        for (shippedPath in template.paths) {
            val shipped = template.getFile(shippedPath)!!
            val hash = template.getHash(shippedPath)!!
            val entryNow = ShippedIndex.Entry(moduleId, template.id, template.version, hash, required)
            val path = YamlFiles.onDisk(projectDir, shippedPath)
            shippedPaths += path
            val entry = index[path]
            if (entry != null && ours(entry) == null) continue // another template's file
            val target = ProjectPathPolicy.resolve(projectDir, path)
            if (!target.exists()) {
                val isExcluded = DocumentLayout.sameFile(path) in excluded
                when {
                    elsewhere(layout, path) -> index[path] = entry ?: entryNow
                    required && (entry != null || isExcluded) -> {
                        changes[path] = shipped
                        index[path] = entryNow
                        restored += path
                    }
                    entry == null && !isExcluded -> {
                        changes[path] = shipped
                        index[path] = entryNow
                    }
                    entry == null -> index[path] = entryNow
                    else -> {
                        if (!isExcluded) excludeNow += YamlFiles.canonical(shippedPath)
                        index[path] = entry.copy(required = required)
                    }
                }
                continue
            }
            if (!target.isFile) continue
            val bytes = target.readBytes()
            when {
                entry == null -> index[path] = entryNow
                entry.hash == hash -> index[path] = entry.copy(required = required)
                untouched(projectDir, path, bytes, entry.hash) -> {
                    changes[path] = shipped
                    index[path] = entryNow
                }
                else -> {
                    index[path] = entry.copy(required = required)
                    SystemFiles.merge(projectDir, path, entry.hash, bytes, shipped)?.let { (content, conflicts) ->
                        if (conflicts.isEmpty()) index[path] = entryNow
                        if (content != null) {
                            changes[path] = content
                            merged[path] = conflicts
                        }
                    }
                }
            }
        }
        // What the module no longer ships.
        for ((path, entry) in index.toList()) {
            if (ours(entry) == null || path in shippedPaths) continue
            val target = ProjectPathPolicy.resolve(projectDir, path)
            if (target.isFile && untouched(projectDir, path, target.readBytes(), entry.hash)) changes[path] = null
            index.remove(path)
        }
        // The shipped content is the base of every file indexed against it.
        for (shippedPath in template.paths) {
            val path = YamlFiles.onDisk(projectDir, shippedPath)
            val hash = template.getHash(shippedPath)!!
            if (YamlFiles.isYaml(path) && index[path]?.hash == hash && !SystemFiles.base(projectDir, hash).isFile) {
                changes["${SystemFiles.BASES}/$hash"] = template.getFile(shippedPath)!!
            }
        }
        val origins = ProjectOrigins.read(projectDir)
        val named = index.values.mapTo(HashSet()) { it.hash } + origins.values.map { it.hash }
        ProjectPathPolicy.resolve(projectDir, SystemFiles.BASES).listFiles()?.forEach { file ->
            if (file.isFile && file.name !in named && "${SystemFiles.BASES}/${file.name}" !in changes) changes["${SystemFiles.BASES}/${file.name}"] = null
        }
        if (excludeNow.isNotEmpty()) SystemFiles.excluded(projectDir, excludeNow)?.let { (name, bytes) -> changes[name] = bytes }
        if (changes.isEmpty() && index == before) return emptyList()
        changes[ShippedIndex.PATH] = ShippedIndex.serialize(index)
        val mirror = origins.filterKeys { it !in before && it !in index } + index.mapValues { it.value.origin }
        changes[ProjectOrigins.PATH] = ProjectOrigins.serialize(mirror)
        projectDir.mkdirs()
        ProjectPublisher(projectDir).commit(
            "system-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        merged.forEach { (path, conflicts) -> onMerged(path, conflicts) }
        restored.forEach(onRestored)
        return changes.keys.filter { it != ProjectOrigins.PATH && it != ShippedIndex.PATH && !it.startsWith("${SystemFiles.BASES}/") }
    }

    /**
     * Whether [bytes] at [path] is still the shipped content of [hash]: the same bytes, or for
     * YAML the same value with no comment the shipped file lacks (a save that only reformatted
     * keeps it untouched; an owner who added a comment made it theirs). Without the base, only
     * the bytes tell.
     */
    fun untouched(projectDir: File, path: String, bytes: ByteArray, hash: String): Boolean {
        if (ContentHash.hashBytes(bytes) == hash) return true
        if (!YamlFiles.isYaml(path)) return false
        val base = SystemFiles.base(projectDir, hash).takeIf { it.isFile }?.readBytes() ?: return false
        if (ContentHash.hashBytes(base) != hash) return false
        val mine = bytes.toString(Charsets.UTF_8)
        val shipped = base.toString(Charsets.UTF_8)
        return YamlEquivalence.sameValue(path, mine, shipped) && (comments(mine) - comments(shipped)).isEmpty()
    }

    private val COMMENT = Regex("(?:^|\\s)(#.*)$")

    /** The comments of a YAML text, trimmed, one per line that has one. */
    fun comments(text: String): Set<String> =
        text.lineSequence().mapNotNull { COMMENT.find(it)?.groupValues?.get(1)?.trim() }.filter { it.length > 1 }.toSet()

    private fun manifestExclusions(projectDir: File): Set<String> {
        val file = ModuleFile.find(projectDir) ?: return emptySet()
        val manifest = runCatching { yaml.readValue(file, ManifestYaml::class.java) }.getOrNull() ?: return emptySet()
        return manifest.originals.exclude.mapTo(HashSet(), DocumentLayout::sameFile)
    }

    private fun folderLayout(projectDir: File): DocumentLayout.Result {
        val paths = projectDir.walkTopDown()
            .onEnter { it == projectDir || !it.name.startsWith(".") }
            .filter { it.isFile }
            .map { it.relativeTo(projectDir).invariantSeparatorsPath }
            .toList()
        return DocumentLayout.classify(paths, DocumentKinds.all().map { it.dir }.toSet())
    }

    /** A Document of the same (variant, kind folder, id) as [path] sits at another path of the folder. */
    private fun elsewhere(layout: DocumentLayout.Result, path: String): Boolean {
        val kindDirs = DocumentKinds.all().map { it.dir }.toSet()
        val probe = DocumentLayout.classify(listOf(path) + if (layout.variants.isNotEmpty()) listOf("variants.yml") else emptyList(), kindDirs)
        val me = (probe.documents + probe.variants).firstOrNull() ?: return false
        return (layout.documents + layout.variants).any { it.variant == me.variant && it.dir == me.dir && it.id == me.id && it.path != path }
    }
}
