package net.artisanmc.plugin.protocol

import net.artisanmc.modules.api.template.TemplateRegistry
import net.artisanmc.plugin.project.ProjectOrigins
import net.artisanmc.plugin.project.TemplateCopies
import java.util.Base64

/**
 * The editor's side of the modules' templates (ADR `module-templates`): read a template's files,
 * copy a template (or some of its files) into a Project, read where a Project's copied files
 * came from. A copy is a disk write like `project_write`, journaled, then reloaded.
 */
class TemplateRequests(
    private val workspace: ProjectWorkspace,
    private val replies: Replies,
    private val templates: () -> TemplateRegistry?,
) {
    private val roots get() = workspace.roots

    fun fetch(request: EditorRequest.TemplateFetch) {
        val reply = replies.to(request, "template_fetch_result")
        val template = templates()?.find(request.moduleId, request.templateId) ?: return reply.error("not_found")
        replies.offThread("template_fetch") {
            reply.ok(
                "module_id" to request.moduleId,
                "template" to template.toWire(),
                "files" to template.paths.map { path ->
                    mapOf("path" to path, "content_base64" to Base64.getEncoder().encodeToString(template.getFile(path)))
                },
            )
        }
    }

    fun copy(request: EditorRequest.TemplateCopy) {
        val reply = replies.to(request, "template_copy_result")
        if (!EditorPaths.isSafeProjectId(request.projectId)) return reply.error("invalid_path")
        val template = templates()?.find(request.moduleId, request.templateId) ?: return reply.error("not_found")
        if (request.paths?.any { template.getHash(it) == null } == true) return reply.error("unknown_path")
        replies.offThread("template_copy", workspace.io) {
            val projectDir = roots.dirFor(request.projectId)
            if (!projectDir.isDirectory) return@offThread reply.error("unknown_project")
            // A module's system elements live in its folder only: copied there, it is a reset.
            if (template.isSystem && roots.ownerOf(request.projectId) != request.moduleId) {
                return@offThread reply.error("system_template")
            }
            try {
                val result = TemplateCopies.copy(projectDir, request.moduleId, template, request.paths, request.replace)
                if (result.conflicts.isNotEmpty()) {
                    return@offThread reply.send(mapOf("ok" to false, "error" to "conflict", "conflicts" to result.conflicts))
                }
                workspace.reload()
                reply.ok("written" to result.written, "unchanged" to result.unchanged)
            } catch (e: Throwable) {
                reply.failure("write_error", "template_copy '${request.projectId}'", e)
            }
        }
    }

    fun origins(request: EditorRequest.ProjectOriginsFetch) {
        val reply = replies.to(request, "project_origins_fetch_result")
        if (!EditorPaths.isSafeProjectId(request.projectId)) return reply.error("invalid_path")
        replies.offThread("project_origins_fetch", workspace.io) {
            val projectDir = roots.dirFor(request.projectId)
            if (!projectDir.isDirectory) return@offThread reply.error("unknown_project")
            reply.ok("origins" to ProjectOrigins.read(projectDir).mapValues { it.value.toWire() })
        }
    }
}
