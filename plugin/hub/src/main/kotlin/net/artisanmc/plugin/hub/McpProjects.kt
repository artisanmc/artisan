package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.protocol.ProtocolVersion
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Who an MCP call acts for: a player, through a client it approved ([grantId]) or its own editor session. */
data class McpPrincipal(
    val playerId: UUID,
    val playerName: String,
    val permissions: Set<String>,
    val grantId: String? = null,
    val clientName: String? = null,
) {
    fun can(permission: String) = permission in permissions
}

/** A refusal an MCP tool reports to the model as is: [code] from [ErrorStatus]'s list, [message] for it to act on. */
class McpRefusal(val code: String, override val message: String) : RuntimeException(message)

/**
 * What the MCP tools reach (ADR `mcp-server`): the Projects as the editor reads them, the
 * player's drafts, and `documents_check` on the Project's server. Blocking, on [McpRoutes]'
 * own threads. Of the draft actions, only those that leave the server's disk untouched exist
 * here: [DRAFT_ACTIONS]. Deploying stays a person's click in the editor.
 */
class McpProjects(
    private val servers: Servers,
    private val loaded: LoadedProjects? = null,
    draftStorage: DraftStorage? = null,
    private val timeoutSeconds: Long = 20,
) {
    private val drafts = draftStorage?.let(::ProjectDrafts)

    fun servers(): List<EditorServer> = servers.all()

    fun project(id: String): ProjectRef = servers.project(id)
        ?: throw McpRefusal("unknown_project", "No Project '$id'. Project ids are `<server id>.<folder>`, as artisan_overview lists them.")

    /** The server's `project_list` reply, from the database when it is recorded. */
    fun list(server: EditorServer): Map<String, Any?> =
        loaded?.list(server.id)?.plus("ok" to true) ?: request(server, mapOf("type" to "project_list"))

    /** The Project's `project_read` reply: `{hash, files, failed, binaries}`. */
    fun read(project: ProjectRef): Map<String, Any?> {
        loaded?.read(project.server.id, project.folder)?.let { return it + ("ok" to true) }
        return request(project.server, mapOf("type" to "project_read", "project_id" to project.folder)).also(::refuseUnlessOk)
    }

    /** `documents_check` on the Project's own server: its kinds, its schemas, its reader. */
    fun check(project: ProjectRef, files: Map<String, String>, deletes: Collection<String>): List<Map<String, Any?>> {
        val server = project.server
        if (!server.online) throw McpRefusal("server_offline", "The server of this Project is offline: documents cannot be checked, so they cannot be written.")
        if (ProtocolVersion.minor(server.protocolVersion) < ProtocolVersion.DOCUMENT_CHECKS)
            throw McpRefusal("plugin_update_required", "The server of this Project runs an older Artisan that cannot check documents.")
        val reply = request(server, mapOf(
            "type" to "documents_check",
            "project_id" to project.folder,
            "files" to files.map { (path, content) -> mapOf("path" to path, "content" to content) },
            "deletes" to deletes.toList(),
        ))
        refuseUnlessOk(reply)
        @Suppress("UNCHECKED_CAST")
        return (reply["problems"] as? List<Map<String, Any?>>).orEmpty()
    }

    /** A draft operation of [principal] on [project]; refused as a draft reply (`ok: false`), not thrown. */
    fun draft(principal: McpPrincipal, project: ProjectRef, action: String, vararg fields: Pair<String, Any?>): Map<String, Any?> {
        require(action in DRAFT_ACTIONS) { "draft action '$action' is not one the MCP endpoint makes" }
        val drafts = drafts ?: throw McpRefusal("database_unavailable", "Drafts need the suite database, which this server does not have open.")
        val message = mapOf(
            "type" to "project_draft_request",
            "project_id" to project.folder,
            "owner_id" to principal.playerId.toString(),
            "action" to action,
            "author_id" to principal.playerId.toString(),
            "author_name" to principal.playerName,
        ) + fields
        val reply = CompletableFuture<Map<String, Any?>>()
        // No publication goes through here: a publisher that would be asked is a bug, and says so.
        val publisher = ProjectDrafts.Publisher { _, answer -> answer(mapOf("ok" to false, "error" to "forbidden")) }
        drafts.handle(project.server.id, project.folder, Call.mapper.valueToTree<ObjectNode>(message), publisher) { reply.complete(it) }
        return reply.get(timeoutSeconds, TimeUnit.SECONDS)
    }

    private fun request(server: EditorServer, message: Map<String, Any?>): Map<String, Any?> {
        if (server.updateRequired) throw McpRefusal("plugin_update_required", "The server '${server.label}' runs an incompatible Artisan.")
        return try {
            server.link.request(message).get(timeoutSeconds, TimeUnit.SECONDS)
        } catch (e: Exception) {
            val cause = (e as? java.util.concurrent.ExecutionException)?.cause ?: (e as? CompletionException)?.cause ?: e
            when (cause) {
                is TimeoutException -> throw McpRefusal("fetch_timeout", "The server '${server.label}' did not answer in time.")
                is ServerOfflineException -> throw McpRefusal("server_offline", "The server '${server.label}' is offline.")
                else -> throw McpRefusal("fetch_error", "The server '${server.label}' could not be reached: ${cause.message}")
            }
        }
    }

    private fun refuseUnlessOk(reply: Map<String, Any?>) {
        if (reply["ok"] == true) return
        val code = reply["error"] as? String ?: "fetch_error"
        throw McpRefusal(code, (reply["message"] as? String) ?: code)
    }

    companion object {
        /** The draft actions an MCP tool may send. No `publish`, `discard` or `write_blob`: an architecture test holds it. */
        val DRAFT_ACTIONS = setOf("list", "read", "create", "update")
    }
}
