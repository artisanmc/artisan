package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.yamlio.Yaml12
import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.plugin.model.ModuleFile
import net.artisanmc.plugin.model.Originals
import net.artisanmc.plugin.model.YamlFiles
import java.io.File
import java.util.UUID

/**
 * Keeps what a module ships in its folder (design `originaux-modules`): a system template
 * (`TemplateDeclaration.isSystem`, the menus and dialogs its code opens by id, **required**) or
 * a template seeded into the module's own folder (examples, **optional**). Each shipped file
 * lives in `originals/<path>`, rewritten from the module at each sync; the owner's folder holds
 * only what the owner changed, and wins id for id (`DocumentLayout`). For the owner's file at
 * the shipped path:
 * - holding the shipped content, or an untouched copy of an earlier version: removed, the
 *   original serves (this is also the migration of a folder that held full copies);
 * - edited, when the module ships another version: merged ([ThreeWayMerge]) from the version
 *   it was copied from, kept in [BASES], to the shipped one; removed when the merge gives the
 *   shipped content. With a conflict, the owner's values stay and the origin stays on the
 *   version it was copied from. A file that is not YAML, or whose base was never kept, stays.
 *   A file that was there before the module shipped it (no origin) counts as edited.
 * - absent: the original serves. An optional file the owner deleted before originals existed
 *   is excluded in the module file (`originals.exclude`), so it does not come back.
 * A file no longer shipped leaves `originals/`; the owner's edited copy stays. `originals/
 * originals.yml` lists the required files ([Originals.Index]).
 *
 * Writes go through one journaled commit, origins and bases included ([ProjectPublisher]), on
 * the workspace's I/O thread like every disk write.
 */
object SystemFiles {
    /**
     * `.artisan/bases/<hash>`: the content of each version an owner's file came from, the base
     * of the next merge. Private (out of every scan and content channel); a base no origin of an
     * owner's file names is removed.
     */
    const val BASES = ".artisan/bases"

    private val yaml = ObjectMapper(Yaml12.factory())

    /** `originals/<path>`, `.yml` for a YAML file whatever the module ships it under. */
    fun originalPath(shippedPath: String): String = "${Originals.DIR}/${YamlFiles.canonical(shippedPath)}"

    /**
     * Paths written; empty when the folder already held every file as it should. [required]:
     * the files cannot be excluded (a system template). [seeded]: the template was copied into
     * this folder before originals existed (an optional file absent there was deleted by the
     * owner). [onMerged] is told each edited file the merge rewrote, with the keys left to the
     * owner's value.
     */
    fun sync(
        projectDir: File,
        moduleId: String,
        template: TemplateDeclaration,
        required: Boolean = template.isSystem,
        seeded: Boolean = false,
        legacy: Boolean = false,
        onRestored: (path: String) -> Unit = {},
        onMerged: (path: String, conflicts: List<String>) -> Unit = { _, _ -> },
    ): List<String> =
        if (legacy || File(projectDir, Originals.DIR).isDirectory) legacySync(projectDir, moduleId, template, required, seeded, onMerged)
        else TreeSync.sync(projectDir, moduleId, template, required, onMerged, onRestored)

    /** The former layout (design `originaux-modules`), for a folder [FolderMigration] has not turned yet. */
    private fun legacySync(
        projectDir: File,
        moduleId: String,
        template: TemplateDeclaration,
        required: Boolean,
        seeded: Boolean,
        onMerged: (path: String, conflicts: List<String>) -> Unit,
    ): List<String> {
        val origins = ProjectOrigins.read(projectDir).toMutableMap()
        val before = origins.toMap()
        val changes = linkedMapOf<String, ByteArray?>()
        val merged = linkedMapOf<String, List<String>>()
        val ours = { o: FileOrigin? -> o?.takeIf { it.module == moduleId && it.template == template.id } }
        val excludeNow = ArrayList<String>()
        val shippedOriginals = HashSet<String>()
        for (shippedPath in template.paths) {
            val shipped = template.getFile(shippedPath)!!
            val hash = template.getHash(shippedPath)!!
            val shippedOrigin = FileOrigin(moduleId, template.id, template.version, hash)
            val original = originalPath(shippedPath)
            shippedOriginals += original
            val originalFile = ProjectPathPolicy.resolve(projectDir, original)
            val firstTime = !originalFile.isFile
            if (firstTime || ContentHash.hashBytes(originalFile.readBytes()) != hash) changes[original] = shipped
            origins[original] = shippedOrigin
            // The owner's file at the shipped place: an old full copy, or the owner's version.
            val path = YamlFiles.onDisk(projectDir, shippedPath)
            val target = ProjectPathPolicy.resolve(projectDir, path)
            val origin = ours(origins[path])
            if (!target.exists()) {
                val deletedByOwner = firstTime && !required && (origin != null || seeded) && !movedElsewhere(projectDir, path)
                if (deletedByOwner) excludeNow += YamlFiles.canonical(shippedPath)
                if (origin != null) origins.remove(path)
                continue
            }
            if (!target.isFile) continue
            val bytes = target.readBytes()
            val current = ContentHash.hashBytes(bytes)
            when {
                current == hash || (origin != null && current == origin.hash) -> {
                    changes[path] = null
                    origins.remove(path)
                }
                origin == null -> origins[path] = shippedOrigin
                origin.hash != hash -> merge(projectDir, path, origin.hash, bytes, shipped)?.let { (content, conflicts) ->
                    if (content.contentEquals(shipped)) {
                        changes[path] = null
                        origins.remove(path)
                    } else {
                        if (conflicts.isEmpty()) origins[path] = shippedOrigin
                        if (content != null) {
                            changes[path] = content
                            merged[path] = conflicts
                        }
                    }
                }
            }
        }
        // What the module no longer ships: its original goes; the owner's untouched copy too,
        // the owner's edited one stays the owner's.
        for ((path, origin) in origins.toList()) {
            if (ours(origin) == null) continue
            if (Originals.isOriginal(path)) {
                if (path !in shippedOriginals) {
                    changes[path] = null
                    origins.remove(path)
                }
                continue
            }
            if (template.paths.any { YamlFiles.onDisk(projectDir, it) == path }) continue
            val target = ProjectPathPolicy.resolve(projectDir, path)
            if (!target.exists()) {
                origins.remove(path)
            } else if (target.isFile && ContentHash.hashBytes(target.readBytes()) == origin.hash) {
                changes[path] = null
                origins.remove(path)
            }
        }
        // The shipped content is the base of every owner's file copied from it.
        for (shippedPath in template.paths) {
            val path = YamlFiles.onDisk(projectDir, shippedPath)
            val hash = template.getHash(shippedPath)!!
            if (origins[path]?.hash == hash && !base(projectDir, hash).isFile) {
                changes["$BASES/$hash"] = template.getFile(shippedPath)!!
            }
        }
        val named = origins.filterKeys { !Originals.isOriginal(it) }.values.mapTo(HashSet()) { it.hash }
        ProjectPathPolicy.resolve(projectDir, BASES).listFiles()?.forEach { file ->
            if (file.isFile && file.name !in named && "$BASES/${file.name}" !in changes) changes["$BASES/${file.name}"] = null
        }
        // The index: the required files of every template of the module.
        val indexFile = ProjectPathPolicy.resolve(projectDir, Originals.INDEX_PATH)
        val oldIndex = Originals.parseIndex(indexFile.takeIf { it.isFile }?.readText())
        val mine = before.filter { (p, o) -> Originals.isOriginal(p) && ours(o) != null }.keys.map { it.removePrefix("${Originals.DIR}/") }.toSet() +
            template.paths.map(YamlFiles::canonical)
        val requiredNow = (oldIndex.required - mine) + (if (required) template.paths.map(YamlFiles::canonical) else emptyList())
        val index = Originals.Index(moduleId, maxOf(oldIndex.version, template.version), requiredNow.distinct().sorted())
        if (index != oldIndex.copy(required = oldIndex.required.sorted())) changes[Originals.INDEX_PATH] = Originals.writeIndex(index)
        if (excludeNow.isNotEmpty()) excluded(projectDir, excludeNow)?.let { (name, bytes) -> changes[name] = bytes }
        if (changes.isEmpty() && origins == before) return emptyList()
        changes[ProjectOrigins.PATH] = ProjectOrigins.serialize(origins)
        projectDir.mkdirs()
        ProjectPublisher(projectDir).commit(
            "system-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            com.fasterxml.jackson.databind.ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        merged.forEach { (path, conflicts) -> onMerged(path, conflicts) }
        return changes.keys.filter { it != ProjectOrigins.PATH && !it.startsWith("$BASES/") }
    }

    /** The module file with [paths] added to `originals.exclude`; null without a module file. */
    internal fun excluded(projectDir: File, paths: List<String>): Pair<String, ByteArray>? {
        val file = ModuleFile.find(projectDir) ?: return null
        @Suppress("UNCHECKED_CAST")
        val root = (runCatching { yaml.readValue(file, Map::class.java) }.getOrNull() as? Map<String, Any?>)?.toMutableMap() ?: return null
        val originals = ((root["originals"] as? Map<String, Any?>)?.toMutableMap() ?: linkedMapOf())
        val list = (originals["exclude"] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
        originals["exclude"] = (list + paths).distinct()
        root["originals"] = originals
        return file.name to EditorYaml.write(root).toByteArray(Charsets.UTF_8)
    }

    internal fun base(projectDir: File, hash: String): File = ProjectPathPolicy.resolve(projectDir, "$BASES/$hash")

    /**
     * The owner keeps their version of [path] (ADR `common-images-and-themes`, decision 8): its
     * origin becomes its original's, as shipped now, so "the original changed since your
     * version" is answered until the original changes again. False when [path] has no original
     * in the folder or no file of the owner's; true when the origin is, or already was, that one.
     */
    fun keep(projectDir: File, path: String): Boolean {
        if (Originals.isOriginal(path) || !ProjectPathPolicy.resolve(projectDir, path).isFile) return false
        val origins = ProjectOrigins.read(projectDir)
        val shipped = origins["${Originals.DIR}/$path"] ?: return false
        if (origins[path] == shipped) return true
        ProjectPublisher(projectDir).commit(
            "system-${UUID.randomUUID()}", UUID.randomUUID().toString(),
            mapOf(ProjectOrigins.PATH to ProjectOrigins.serialize(origins + (path to shipped))),
            com.fasterxml.jackson.databind.ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        return true
    }

    /**
     * What a deploy of [changes] (path → bytes, null for a delete) writes beside them: the
     * origin of each file the owner makes over an original the folder holds (ADR
     * `common-images-and-themes`, decision 8). The origin is that original's as it is on disk
     * now, the one the owner saw: when the module ships another before the next sync, "the
     * original changed since your version" is said, where [sync] would have recorded the new
     * one as what the file was made against. A YAML file's base is kept too, so that it merges.
     * A file already there with an origin keeps it; a rename loses the link as before.
     * Empty when there is nothing to record.
     */
    fun madeAgainst(projectDir: File, changes: Map<String, ByteArray?>): Map<String, ByteArray?> {
        val origins = ProjectOrigins.read(projectDir)
        if (origins.keys.none(Originals::isOriginal)) return emptyMap()
        val made = linkedMapOf<String, FileOrigin>()
        val out = linkedMapOf<String, ByteArray?>()
        for ((path, bytes) in changes) {
            if (bytes == null || Originals.isOriginal(path) || path.startsWith(".artisan")) continue
            val original = originalPath(path)
            val shipped = origins[original] ?: continue
            // A file already there keeps the origin it has; a stale one (the file was deleted) is replaced.
            if (origins[path] == shipped || (origins[path] != null && ProjectPathPolicy.resolve(projectDir, path).isFile)) continue
            made[path] = shipped
            if (YamlFiles.isYaml(path) && !base(projectDir, shipped.hash).isFile) {
                val content = ProjectPathPolicy.resolve(projectDir, original).takeIf { it.isFile }?.readBytes()
                if (content != null && ContentHash.hashBytes(content) == shipped.hash) out["$BASES/${shipped.hash}"] = content
            }
        }
        if (made.isEmpty()) return emptyMap()
        out[ProjectOrigins.PATH] = ProjectOrigins.serialize(origins + made)
        return out
    }

    /**
     * The owner's file [ours] merged with [shipped] from the base [baseHash]: the bytes to write
     * (null when the merge is the owner's file as is) and the conflicts; null when it cannot be
     * merged (not YAML, no base, a document that is not a map).
     */
    internal fun merge(projectDir: File, path: String, baseHash: String, ours: ByteArray, shipped: ByteArray): Pair<ByteArray?, List<String>>? {
        if (!path.endsWith(".yaml") && !path.endsWith(".yml")) return null
        val baseFile = base(projectDir, baseHash).takeIf { it.isFile } ?: return null
        val base = baseFile.readBytes().takeIf { ContentHash.hashBytes(it) == baseHash } ?: return null
        val (b, o, t) = runCatching { listOf(base, ours, shipped).map { yaml.readValue(it, Any::class.java) } }.getOrNull() ?: return null
        if (b !is Map<*, *> || o !is Map<*, *> || t !is Map<*, *>) return null
        val result = ThreeWayMerge.merge(b, o, t)
        @Suppress("UNCHECKED_CAST")
        val content = when (val value = result.value as? Map<String, Any?> ?: return null) {
            o -> null
            t -> shipped
            else -> EditorYaml.write(value).toByteArray(Charsets.UTF_8)
        }
        return content to result.conflicts
    }

    /**
     * A file of the same name under a kind folder of the same name elsewhere in the module
     * (`armes/menus/shop.yaml` for `menus/shop.yaml`): the same Document, moved. Writing it
     * again would give the module two Documents with one id, both refused.
     */
    private fun movedElsewhere(projectDir: File, path: String): Boolean {
        val name = path.substringAfterLast('/')
        val stem = YamlFiles.stem(name) ?: name
        val kindDir = path.substringBeforeLast('/', "").substringAfterLast('/')
        if (kindDir.isEmpty()) return false
        return projectDir.walkTopDown()
            .onEnter { it == projectDir || !it.name.startsWith(".artisan") }
            .any { it.isFile && (YamlFiles.stem(it.name) ?: it.name) == stem && it.parentFile.name == kindDir }
    }
}
