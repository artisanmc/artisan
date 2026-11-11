package net.artisanmc.plugin.protocol

import net.artisanmc.plugin.protocol.EditorRequest.DocumentsCheck

/**
 * `documents_check`: whether files would load on this server, before anything is written
 * (ADR `mcp-server`). Checked against the Project this server loaded, by this server's own
 * kinds, schemas and reader: the hub may run another release, or lack a module's kind.
 */
class DocumentChecks(
    private val workspace: ProjectWorkspace,
    private val replies: Replies,
    private val check: DocumentCheck = DocumentCheck(),
) {
    fun check(request: DocumentsCheck) {
        val reply = replies.to(request, "documents_check_result")
        val projectId = request.projectId
        if (!EditorPaths.isSafeProjectId(projectId)) return reply.error("invalid_path")
        if (request.files.values.sumOf { it.length } > MAX_CHARS) return reply.error("too_large")
        replies.offThread("documents_check") {
            try {
                val tree = workspace.snapshot.files[projectId] ?: return@offThread reply.error("unknown_project")
                val problems = check.check(projectId, tree, request.files, request.deletes)
                reply.ok("problems" to problems.map { mapOf("path" to it.path, "stage" to it.stage, "message" to it.message) })
            } catch (e: Throwable) {
                reply.failure("check_error", "documents_check '$projectId'", e)
            }
        }
    }

    private companion object {
        const val MAX_CHARS = 2_000_000
    }
}
