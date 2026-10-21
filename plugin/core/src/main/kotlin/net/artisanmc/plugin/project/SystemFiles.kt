package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
import java.io.File
import java.util.UUID

/**
 * Keeps a module's system elements in its folder (a system template, `TemplateDeclaration.isSystem`,
 * design `framework-commandes` §3.8): the menus and dialogs its code opens by id. Each file is
 * the shipped version until the owner edits it, then the owner's until the editor resets it:
 * - missing: written, unless a file of that name was moved to another folder of the module;
 * - an untouched copy of an earlier version: replaced by the shipped one;
 * - holding the shipped content: only its origin is recorded;
 * - edited: kept. Its origin stays on the version it was copied from, so the editor tells
 *   that the module ships another one. A file that was there before the module made it a
 *   system element (no origin) counts as edited from the shipped version.
 *
 * Writes go through one journaled commit, origins included ([ProjectPublisher]), on the
 * workspace's I/O thread like every disk write.
 */
object SystemFiles {

    /** Paths written; empty when the folder already held every file as it should. */
    fun sync(projectDir: File, moduleId: String, template: TemplateDeclaration): List<String> {
        require(template.isSystem) { "template '${template.id}' is not a system template" }
        val origins = ProjectOrigins.read(projectDir).toMutableMap()
        val before = origins.toMap()
        val changes = linkedMapOf<String, ByteArray?>()
        for (path in template.paths) {
            val shipped = template.getFile(path)!!
            val hash = template.getHash(path)!!
            val shippedOrigin = FileOrigin(moduleId, template.id, template.version, hash)
            val target = ProjectPathPolicy.resolve(projectDir, path)
            val origin = origins[path]?.takeIf { it.module == moduleId && it.template == template.id }
            if (!target.exists()) {
                if (movedElsewhere(projectDir, path)) continue
                changes[path] = shipped
                origins[path] = shippedOrigin
                continue
            }
            if (!target.isFile) continue
            val current = ContentHash.hashBytes(target.readBytes())
            when {
                current == hash -> origins[path] = shippedOrigin
                origin != null && current == origin.hash -> {
                    changes[path] = shipped
                    origins[path] = shippedOrigin
                }
                origin == null -> origins[path] = shippedOrigin
            }
        }
        if (changes.isEmpty() && origins == before) return emptyList()
        changes[ProjectOrigins.PATH] = ProjectOrigins.serialize(origins)
        projectDir.mkdirs()
        ProjectPublisher(projectDir).commit(
            "system-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            com.fasterxml.jackson.databind.ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        return changes.keys.filter { it != ProjectOrigins.PATH }
    }

    /**
     * A file of the same name under a kind folder of the same name elsewhere in the module
     * (`armes/menus/shop.yaml` for `menus/shop.yaml`): the same Document, moved. Writing it
     * again would give the module two Documents with one id, both refused.
     */
    private fun movedElsewhere(projectDir: File, path: String): Boolean {
        val name = path.substringAfterLast('/')
        val kindDir = path.substringBeforeLast('/', "").substringAfterLast('/')
        if (kindDir.isEmpty()) return false
        return projectDir.walkTopDown()
            .onEnter { it == projectDir || !it.name.startsWith(".artisan") }
            .any { it.isFile && it.name == name && it.parentFile.name == kindDir }
    }
}
