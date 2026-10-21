package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
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

    /**
     * Copies [paths] of [template] (all of them when null) into [projectDir]. With conflicts
     * and [replace] off, writes nothing and returns them.
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
        val selected = paths ?: template.paths
        selected.forEach { require(template.getHash(it) != null) { "unknown_path" } }
        val written = mutableListOf<String>()
        val unchanged = mutableListOf<String>()
        val conflicts = mutableListOf<String>()
        val changes = linkedMapOf<String, ByteArray?>()
        for (path in selected) {
            val shipped = template.getFile(path)!!
            val target = ProjectPathPolicy.resolve(projectDir, path)
            when {
                !target.exists() -> { changes[path] = shipped; written += path }
                target.isFile && ContentHash.hashBytes(target.readBytes()) == template.getHash(path) -> unchanged += path
                replace && target.isFile -> { changes[path] = shipped; written += path }
                else -> conflicts += path
            }
        }
        if (conflicts.isNotEmpty()) return Result(emptyList(), emptyList(), conflicts)

        val origins = ProjectOrigins.read(projectDir).toMutableMap()
        for (path in written + unchanged) {
            origins[path] = FileOrigin(moduleId, template.id, template.version, template.getHash(path)!!)
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
            seedOwnFolder(roots.dirFor(existing), moduleId, template, key)
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

    /** Into the module's own folder, created empty by `moduleFolder`: a file already there wins. */
    private fun seedOwnFolder(dir: File, moduleId: String, template: TemplateDeclaration, key: String): Boolean {
        if (!File(dir, "manifest.yaml").isFile) writeManifest(dir)
        val result = TemplateCopies.copy(dir, moduleId, template)
        if (result.conflicts.isNotEmpty()) {
            logger?.warning("[Artisan] Template '$key' not seeded into ${dir.path}: ${result.conflicts.joinToString()} already hold other content.")
        } else {
            logger?.info("[Artisan] Template '$key' seeded into the module's folder ${dir.path}.")
        }
        return result.written.isNotEmpty()
    }

    /** Before the files: a folder without `manifest.yaml` is not a project. */
    private fun writeManifest(dir: File) {
        val lang = defaultLang().substringBefore('_').substringBefore('-').lowercase()
            .takeIf { it.matches(Regex("[a-z]{2,3}")) } ?: "en"
        dir.mkdirs()
        val tmp = File(dir, "manifest.yaml.tmp")
        tmp.writeText("schema: manifest/v1\ndefault_lang: $lang\nlanguages: [$lang]\n")
        java.nio.file.Files.move(tmp.toPath(), File(dir, "manifest.yaml").toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING)
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
