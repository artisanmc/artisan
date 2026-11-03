package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.plugin.model.ModuleFile
import net.artisanmc.plugin.model.YamlFiles
import java.io.File
import java.util.UUID

/**
 * Copies a module's template into a Project (ADR `module-templates`): the files, and their
 * origin in `.artisan/origins.yaml`, in one journaled commit ([ProjectPublisher]).
 *
 * A file already in the Project is never overwritten unless asked ([replace]): it may be the
 * owner's work. One with exactly the shipped content is only recorded as a copy. Caller holds
 * the roots' monitor, like every [ProjectPublisher] use.
 */
object TemplateCopies {

    data class Result(
        /** Paths written. */
        val written: List<String>,
        /** Paths that already held the shipped content: only their origin was recorded. */
        val unchanged: List<String>,
        /** Paths holding other content, left alone because [replace] was off: nothing was written. */
        val conflicts: List<String>,
    )

    /** The path [template] ships [path] under: [path] itself, or its other YAML spelling. */
    fun shipped(template: TemplateDeclaration, path: String): String? {
        if (template.getHash(path) != null) return path
        val stem = YamlFiles.stem(path) ?: return null
        return template.paths.firstOrNull { YamlFiles.stem(it) == stem }
    }

    /**
     * Copies [paths] of [template] (all of them when null) into [projectDir], a YAML file under
     * the spelling it has there, else `.yml` ([YamlFiles.onDisk]): the paths returned are the
     * project's. With conflicts and [replace] off, writes nothing and returns them. [paths] may
     * name a file as the module ships it or as the project holds it ([shipped]).
     *
     * @throws IllegalArgumentException for a path the template does not hold.
     */
    fun copy(
        projectDir: File,
        moduleId: String,
        template: TemplateDeclaration,
        paths: List<String>? = null,
        replace: Boolean = false,
    ): Result {
        val selected = paths?.map { requireNotNull(shipped(template, it)) { "unknown_path" } }?.distinct() ?: template.paths
        val written = mutableListOf<String>()
        val unchanged = mutableListOf<String>()
        val conflicts = mutableListOf<String>()
        val changes = linkedMapOf<String, ByteArray?>()
        val shippedAs = mutableMapOf<String, String>()
        for (path in selected) {
            val shipped = template.getFile(path)!!
            // A YAML file goes where its twin is, else under `.yml` (YamlFiles).
            val disk = YamlFiles.onDisk(projectDir, path).also { shippedAs[it] = path }
            val target = ProjectPathPolicy.resolve(projectDir, disk)
            when {
                !target.exists() -> { changes[disk] = shipped; written += disk }
                target.isFile && ContentHash.hashBytes(target.readBytes()) == template.getHash(path) -> unchanged += disk
                replace && target.isFile -> { changes[disk] = shipped; written += disk }
                else -> conflicts += disk
            }
        }
        if (conflicts.isNotEmpty()) return Result(emptyList(), emptyList(), conflicts)

        val origins = ProjectOrigins.read(projectDir).toMutableMap()
        for (disk in written + unchanged) {
            origins[disk] = FileOrigin(moduleId, template.id, template.version, template.getHash(shippedAs.getValue(disk))!!)
        }
        changes[ProjectOrigins.PATH] = ProjectOrigins.serialize(origins)
        projectDir.mkdirs()
        ProjectPublisher(projectDir).commit(
            "template-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            com.fasterxml.jackson.databind.ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        return Result(written, unchanged, emptyList())
    }
}

/**
 * The templates already seeded on this server (`<core projects root>/.artisan-seeds.yaml`): a
 * template with a seed project is copied once, the first time a start knows it, and never
 * again, even when its project was deleted since. Deleting an example is the owner's choice.
 */
class TemplateSeeds(
    private val roots: ProjectRoots,
    private val logger: java.util.logging.Logger? = null,
    /** The server's language (`fr`), the seeded project's only one. */
    private val defaultLang: () -> String = { "en" },
) {
    private val file get() = File(roots.coreRoot, FILE)
    private val yaml = com.fasterxml.jackson.databind.ObjectMapper(com.fasterxml.jackson.dataformat.yaml.YAMLFactory())

    /** The `<module>/<template>` keys already seeded. */
    fun seeded(): Set<String> {
        if (!file.isFile) return emptySet()
        val node = runCatching { yaml.readTree(file) }.getOrNull() ?: return emptySet()
        return node.path("seeded").mapNotNull { it.asText(null) }.toSet()
    }

    /**
     * Seeds [template] of [moduleId] if it names a seed project and was never seeded: creates
     * that project in the core root, with a manifest in the server's language (a template ships
     * none), and copies the files there. A project of that name that already exists is left
     * alone (the owner's, or an earlier copy), unless it is the module's own folder
     * (`moduleFolder`): the files go there, next to what it holds, none overwritten. Either way
     * the template counts as seeded. Returns true when files were written.
     */
    fun seed(moduleId: String, template: TemplateDeclaration): Boolean {
        val projectId = template.seedProject ?: return false
        val key = "$moduleId/${template.id}"
        if (key in seeded()) return false
        val existing = roots.all().keys.firstOrNull { it.equals(projectId, ignoreCase = true) }
        val wrote = if (existing != null && roots.ownerOf(existing) == moduleId) {
            seedOwnFolder(roots.dirFor(existing), key)
        } else if (existing != null) {
            logger?.info("[Artisan] Template '$key' not seeded: a project '$projectId' already exists.")
            false
        } else {
            val dir = File(roots.coreRoot, projectId)
            writeManifest(dir)
            TemplateCopies.copy(dir, moduleId, template)
            logger?.info("[Artisan] Template '$key' seeded into the new project '$projectId'.")
            true
        }
        record(key)
        return wrote
    }

    /**
     * Into the module's own folder, created empty by `moduleFolder`: only its module file. The
     * files themselves are originals (design `originaux-modules`), kept by [SystemFiles] at
     * each start like a system template's, but optional ([ownFolderSeed]).
     */
    private fun seedOwnFolder(dir: File, key: String): Boolean {
        if (ModuleFile.find(dir) != null) return false
        writeManifest(dir)
        logger?.info("[Artisan] Template '$key' seeded into the module's folder ${dir.path}.")
        return true
    }

    /** The module's own folder when [template] seeds it: its examples are originals there. */
    fun ownFolderSeed(moduleId: String, template: TemplateDeclaration): File? {
        val projectId = template.seedProject ?: return null
        val existing = roots.all().keys.firstOrNull { it.equals(projectId, ignoreCase = true) } ?: return null
        return if (roots.ownerOf(existing) == moduleId) roots.dirFor(existing) else null
    }

    /** Before the files: a folder without a module file is not a project. */
    private fun writeManifest(dir: File) {
        val lang = defaultLang().substringBefore('_').substringBefore('-').lowercase()
            .takeIf { it.matches(Regex("[a-z]{2,3}")) } ?: "en"
        dir.mkdirs()
        val tmp = File(dir, "${ModuleFile.NAME}.tmp")
        tmp.writeText("schema: ${ModuleFile.SCHEMA}\ndefault_lang: $lang\nlanguages: [$lang]\n")
        java.nio.file.Files.move(tmp.toPath(), File(dir, ModuleFile.NAME).toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    }

    private fun record(key: String) {
        val keys = (seeded() + key).sorted()
        roots.coreRoot.mkdirs()
        val tmp = File(roots.coreRoot, "$FILE.tmp")
        tmp.writeBytes(yaml.writeValueAsBytes(mapOf("seeded" to keys)))
        java.nio.file.Files.move(tmp.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    }

    companion object {
        const val FILE = ".artisan-seeds.yaml"
    }
}
