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
    /**
     * False for the editor's assistant: it keeps the player's publish permission for `create_module`
     * (an empty folder) but never deploys, whatever the permissions say.
     */
    val deploys: Boolean = true,
) {
    fun can(permission: String) = permission in permissions

    /** May deploy a draft or roll back a Version for the player. */
    val canDeploy: Boolean get() = deploys && can(EditorPermissions.PUBLISH)
}

/** A refusal an MCP tool reports to the model as is: [code] from [ErrorStatus]'s list, [message] for it to act on. */
class McpRefusal(val code: String, override val message: String) : RuntimeException(message)

/**
 * What the MCP tools reach (ADR `mcp-server`): the Projects as the editor reads them, the
 * player's drafts, their Versions, and `documents_check` on the Project's server. Blocking, on
 * [McpRoutes]' own threads. The draft actions are [DRAFT_ACTIONS]: the only write to a server's
 * disk is `publish`, the editor's own (compare-and-swap, the server's checks), for a principal
 * that holds [EditorPermissions.PUBLISH]: a player who allowed the app to deploy.
 */
class McpProjects(
    private val servers: Servers,
    private val loaded: LoadedProjects? = null,
    draftStorage: DraftStorage? = null,
    private val history: ProjectHistory? = null,
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
        val publishing = action == "publish"
        if (publishing && !principal.canDeploy) throw McpRefusal("forbidden", NOT_ALLOWED)
        val drafts = drafts ?: throw McpRefusal("database_unavailable", "Drafts need the suite database, which this server does not have open.")
        val message = mapOf(
            "type" to "project_draft_request",
            "project_id" to project.folder,
            "owner_id" to principal.playerId.toString(),
            "action" to action,
            "author_id" to principal.playerId.toString(),
            "author_name" to principal.playerName,
            // The Version a publication makes reads "<player> via <app>".
            "author_via" to principal.clientName,
        ) + fields
        val reply = CompletableFuture<Map<String, Any?>>()
        val publisher = if (publishing) relay(project.server) else ProjectDrafts.Publisher { _, answer -> answer(mapOf("ok" to false, "error" to "forbidden")) }
        drafts.handle(project.server.id, project.folder, Call.mapper.valueToTree<ObjectNode>(message), publisher) { reply.complete(it) }
        // The drafts answer with JSON nodes inside (a draft as stored): plain maps and lists for the tools.
        @Suppress("UNCHECKED_CAST")
        return Call.mapper.convertValue(reply.get(if (publishing) PUBLISH_TIMEOUT else timeoutSeconds, TimeUnit.SECONDS), Map::class.java) as Map<String, Any?>
    }

    /**
     * A new, empty Project folder on [server] (`project_create`, as the editor's "New module"), for a
     * principal that holds [EditorPermissions.PUBLISH], like the editor's route. It holds nothing:
     * what goes in it reaches players only through a deployed draft.
     */
    fun create(principal: McpPrincipal, server: EditorServer, folder: String): ProjectRef {
        if (!principal.can(EditorPermissions.PUBLISH)) throw McpRefusal("forbidden", "Creating a module takes the player's artisan.editor.publish.")
        if (!server.online) throw McpRefusal("server_offline", "The server '${server.label}' is offline: a module cannot be created on it.")
        if (ProtocolVersion.minor(server.protocolVersion) < ProtocolVersion.PROJECT_FOLDERS)
            throw McpRefusal("plugin_update_required", "The server '${server.label}' runs an older Artisan that cannot create modules.")
        refuseUnlessOk(request(server, mapOf("type" to "project_create", "project_id" to folder)))
        return ProjectRef(server, folder)
    }

    /** The Project's Versions, newest first (`{id, createdAt, author, changed}`); null without the suite database. */
    fun versions(project: ProjectRef): List<Map<String, Any?>>? = history?.versions(project.server.id, project.folder)

    /** Version [id]'s files: `{id, files: [{path, content}], binaries: [{path, hash, size}]}`. */
    fun version(project: ProjectRef, id: String): Map<String, Any?>? = history?.version(project.server.id, project.folder, id)

    fun versionBinary(project: ProjectRef, id: String, path: String): ByteArray? = history?.versionBinary(project.server.id, project.folder, id, path)

    /** Sends a publication the drafts built to the Project's server, as the editor's route does; its answer, or why there is none. */
    private fun relay(server: EditorServer) = ProjectDrafts.Publisher { publication, answer ->
        if (server.updateRequired) return@Publisher answer(mapOf("ok" to false, "error" to "plugin_update_required"))
        // The answer arrives on the server socket's reader thread: the commit that follows (a database write) leaves it.
        server.link.request(publication).orTimeout(PUBLISH_TIMEOUT - 5, TimeUnit.SECONDS).whenCompleteAsync { result, error ->
            val cause = (error as? CompletionException)?.cause ?: error
            answer(result ?: mapOf("ok" to false, "error" to if (cause is ServerOfflineException) "server_offline" else "fetch_timeout"))
        }
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
        /**
         * The draft actions an MCP tool may send. `publish` only for a principal that may deploy; no
         * `discard`: a draft the player did not want stays theirs to discard. An architecture test holds it.
         */
        val DRAFT_ACTIONS = setOf("list", "read", "create", "update", "write_blob", "publish")

        /** A publication waits on the server's checks and its write: longer than a read. */
        private const val PUBLISH_TIMEOUT = 60L

        const val NOT_ALLOWED = "This app may not deploy for the player: drafts only. The player can allow it in the editor, " +
            "Settings → AI apps (it takes their own artisan.editor.publish), or deploy the draft themselves."
    }
}
