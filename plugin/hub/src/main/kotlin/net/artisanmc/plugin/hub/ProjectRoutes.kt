package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.plugin.hub.Servers.Companion.LOCAL
import net.artisanmc.plugin.hub.EditorPermissions.EDIT
import net.artisanmc.plugin.hub.EditorPermissions.PUBLISH
import net.artisanmc.plugin.hub.EditorPermissions.VIEW
import net.artisanmc.plugin.hub.Relay.Companion.body
import net.artisanmc.plugin.hub.Relay.Companion.errorCode
import net.artisanmc.plugin.hub.Relay.Companion.ok
import net.artisanmc.plugin.hub.Relay.Companion.readError
import net.artisanmc.plugin.hub.ServerRoutes.Companion.EDITOR_ACCESS
import net.artisanmc.plugin.hub.ServerRoutes.Companion.SERVER
import net.artisanmc.plugin.protocol.ProtocolVersion
import java.util.Base64
import java.util.UUID
import net.artisanmc.plugin.sync.BundleHasher

/**
 * Projects, publishing and drafts. A Project's id comes from its folder name
 * ([Servers.project]): without a database, that is the only identity there is.
 */
class ProjectRoutes(
    private val servers: Servers,
    private val relay: Relay,
    private val history: ProjectHistory? = null,
    private val loaded: LoadedProjects? = null,
    draftStorage: DraftStorage? = null,
    private val logger: java.util.logging.Logger? = null,
) {
    private val drafts = draftStorage?.let(::ProjectDrafts)
    fun register(router: Router) {
        router.on("GET", "$SERVER/projects", VIEW) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            listed(call, server) { reply ->
                if (!ok(reply)) return@listed readError(call, reply)
                val projects = roots(reply).map { summary(server, it) }
                call.json(mapOf(
                    "project_ids" to (reply["project_ids"] as? List<*>).orEmpty().map { ProjectRef.id(server.id, it as String) },
                    "projects" to projects,
                    "pending_renames" to emptyList<Any>(),
                ))
            }
        }
        onProject(router, "GET", "/api/v1/user/projects/:project", VIEW) { call, project ->
            val server = project.server
            listed(call, server) { reply ->
                if (!ok(reply)) return@listed readError(call, reply)
                val root = roots(reply).firstOrNull { it["project_id"] == project.folder } ?: return@listed call.error(404, "not_found")
                val movable = movable(server, root)
                call.json(mapOf(
                    "project" to summary(server, root),
                    "networkId" to LOCAL,
                    "serverKeyId" to server.uuid,
                    "capabilities" to mapOf(
                        "liveData" to true, "captureInGame" to false, "preview" to true, "canRename" to movable,
                        // No assistant or migration in the self-hosted editor.
                        "canUseAssistant" to false, "canDelete" to movable, "canCopyToServer" to false,
                    ),
                    "minecraftVersion" to server.minecraftVersion,
                    // Offline: the Project opens from the database, without live data or capture.
                    "connection" to mapOf("available" to server.online),
                ))
            }
        }
        onProject(router, "GET", "/api/v1/projects/:project/editor-access", VIEW) { call, project ->
            listed(call, project.server) { reply ->
                val root = roots(reply).firstOrNull { it["project_id"] == project.folder }
                val origin = if (root?.get("identity") == "addon") "module" else "personal"
                call.json(EDITOR_ACCESS + ("projectOrigin" to origin))
            }
        }

        for (base in listOf("/api/v1/projects/:project", "$SERVER/projects/:project")) {
            onProject(router, "GET", "$base/files", VIEW, ::read)
            onProject(router, "PUT", "$base/files", PUBLISH, ::write)
            onProject(router, "GET", "$base/history", VIEW, ::history)
        }
        onProject(router, "GET", "/api/v1/projects/:project/binary", VIEW, ::asset)
        onProject(router, "GET", "$SERVER/projects/:project/asset", VIEW, ::asset)
        onProject(router, "GET", "/api/v1/projects/:project/versions", VIEW) { call, project ->
            call.json(mapOf("versions" to (history?.versions(project.server.id, project.folder) ?: emptyList<Any>())))
        }
        onProject(router, "GET", "/api/v1/projects/:project/versions/:version/binary", VIEW) { call, project ->
            val path = call.query("path") ?: return@onProject call.error(422, "invalid_input")
            history?.versionBinary(project.server.id, project.folder, call.params.getValue("version"), path)
                ?.let { call.send(200, contentType(path), it, "private, max-age=31536000, immutable") }
                ?: call.error(404, "not_found")
        }
        onProject(router, "GET", "/api/v1/projects/:project/versions/:version", VIEW) { call, project ->
            history?.version(project.server.id, project.folder, call.params.getValue("version"))?.let(call::json)
                ?: call.error(404, "not_found")
        }

        drafts(router)
        lifecycle(router)
    }

    /** Create, delete (to the server's trash) and rename a Project folder. */
    private fun lifecycle(router: Router) {
        router.on("POST", "/api/v1/network/projects", PUBLISH) { call ->
            val request = call.body()
            val name = request?.get("name")?.takeIf { it.isTextual }?.asText()?.trim()
            val serverId = request?.get("serverKeyId")?.takeIf { it.isTextual }?.asText()
            if (name.isNullOrEmpty() || serverId == null) return@on call.error(422, "invalid_input")
            val server = servers.byUuid(serverId)
                ?: return@on call.error(404, "server_key_not_in_network")
            if (!speaksFolders(call, server)) return@on
            relay.send(call, server, mapOf("type" to "project_create", "project_id" to name)) { reply ->
                if (!ok(reply)) return@send folderError(call, reply)
                call.json(mapOf("project" to summary(server, mapOf("project_id" to name, "identity" to "folder"))), 201)
            }
        }
        onProject(router, "DELETE", "/api/v1/user/projects/:project", PUBLISH) { call, project ->
            if (!speaksFolders(call, project.server)) return@onProject
            relay.send(call, project.server, mapOf("type" to "project_delete", "project_id" to project.folder)) { reply ->
                if (ok(reply)) call.json(mapOf("ok" to true)) else folderError(call, reply)
            }
        }
        onProject(router, "POST", "/api/v1/projects/:project/rename", PUBLISH) { call, project ->
            val target = call.body()?.get("targetId")?.takeIf { it.isTextual }?.asText()?.trim()
            if (target.isNullOrEmpty()) return@onProject call.error(422, "invalid_input")
            if (!speaksFolders(call, project.server)) return@onProject
            val message = mapOf("type" to "project_rename", "project_id" to project.folder, "target_project_id" to target)
            relay.send(call, project.server, message) { reply ->
                if (!ok(reply)) return@send folderError(call, reply)
                call.json(mapOf("projectId" to ProjectRef.id(project.server.id, target), "diskId" to target))
            }
        }
    }

    /** A leaf on an older release would ignore the message: say so instead of waiting for the timeout. */
    private fun speaksFolders(call: Call, server: EditorServer): Boolean {
        if (ProtocolVersion.minor(server.protocolVersion) >= ProtocolVersion.PROJECT_FOLDERS) return true
        call.error(501, "plugin_update_required")
        return false
    }

    private fun folderError(call: Call, reply: Map<String, Any?>) = when (val code = errorCode(reply)) {
        "project_exists", "destination_exists", "addon_immutable" -> call.error(409, code)
        "invalid_name", "invalid_path" -> call.error(422, code)
        else -> readError(call, reply)
    }

    private fun movable(server: EditorServer, root: Map<String, Any?>) =
        root["identity"] == "folder" && ProtocolVersion.minor(server.protocolVersion) >= ProtocolVersion.PROJECT_FOLDERS

    /** A URL naming its content's hash never changes content: the browser keeps it for good. */
    private fun cacheFor(bytes: ByteArray, hash: String?): String =
        if (hash != null && BundleHasher.hashBytes(bytes) == hash) "private, max-age=31536000, immutable" else "private, no-cache"

    private fun onProject(router: Router, method: String, pattern: String, permission: String, handler: (Call, ProjectRef) -> Unit) {
        router.on(method, pattern, permission) { call ->
            val project = servers.projectOf(call) ?: return@on call.error(404, "not_found")
            handler(call, project)
        }
    }

    /** The Project list a server loaded: from the database, else asked to the server. */
    private fun listed(call: Call, server: EditorServer, respond: (Map<String, Any?>) -> Unit) {
        loaded?.list(server.id)?.let { return respond(it + ("ok" to true)) }
        relay.send(call, server, mapOf("type" to "project_list"), respond)
    }

    private fun read(call: Call, project: ProjectRef) {
        loaded?.read(project.server.id, project.folder)?.let { body ->
            val ifHash = call.query("if_hash")
            // An offline server's copy is dated: the editor opens it, publishing waits for the server.
            val offline = if (project.server.online) emptyMap()
            else mapOf("offlineSince" to (servers.lastSeen(project.server.id)?.toString() ?: ""))
            return call.json((if (ifHash != null && ifHash == body["hash"]) mapOf("unchanged" to true, "hash" to ifHash) else body) + offline)
        }
        val message = mapOf("type" to "project_read", "project_id" to project.folder, "if_hash" to call.query("if_hash"))
        relay.send(call, project.server, message) { reply -> if (ok(reply)) call.json(body(reply)) else readError(call, reply) }
    }

    private fun write(call: Call, project: ProjectRef) {
        val request = call.body()
        if (request == null || !request.path("files").isArray) return call.error(422, "invalid_input")
        val operationId = operationId(request) ?: return call.error(422, "invalid_input")
        val message = buildMap<String, Any?> {
            put("type", "project_write")
            put("project_id", project.folder)
            put("operation_id", operationId)
            put("files", request["files"])
            put("deletes", request["deletes"] ?: emptyList<Any>())
            put("renames", request["renames"] ?: emptyList<Any>())
            put("create", request.path("create").asBoolean(false))
            request["binaries"]?.let { put("binaries", it) }
            putAll(author(call))
        }
        relay.send(call, project.server, message) { reply ->
            val error = errorCode(reply)
            val detail = reply["message"] as? String
            when {
                ok(reply) -> call.json(mapOf("ok" to true))
                error == "conflict" -> call.json(
                    mapOf("error" to "conflict", "conflicts" to reply["conflicts"], "disk_files" to reply["disk_files"]), 409,
                )
                detail in OPERATION_ERRORS -> call.json(mapOf("error" to detail), 409)
                error in OPERATION_ERRORS -> call.json(mapOf("error" to error), 409)
                else -> readError(call, reply)
            }
        }
    }

    private fun history(call: Call, project: ProjectRef) {
        val path = call.query("path") ?: return call.error(422, "invalid_input")
        history?.fileHistory(project.server.id, project.folder, path)?.let { return call.json(mapOf("versions" to it)) }
        // Archives of `.artisan/history/`, from before Versions.
        relay.send(call, project.server, mapOf("type" to "project_history", "project_id" to project.folder, "path" to path)) { reply ->
            if (ok(reply)) call.json(mapOf("versions" to reply["versions"])) else readError(call, reply)
        }
    }

    private fun asset(call: Call, project: ProjectRef) {
        val path = call.query("path") ?: return call.error(422, "invalid_input")
        loaded?.binary(project.server.id, project.folder, path)?.let { return call.send(200, contentType(path), it, cacheFor(it, call.query("h"))) }
        relay.send(call, project.server, mapOf("type" to "asset_read", "project_id" to project.folder, "path" to path)) { reply ->
            val content = reply["content_base64"] as? String
            if (!ok(reply) || content == null) return@send readError(call, reply)
            val bytes = Base64.getDecoder().decode(content)
            call.send(200, contentType(path), bytes, cacheFor(bytes, call.query("h")))
        }
    }

    /** Private drafts, one set per player: in the suite database ([ProjectDrafts]), else on the server's disk. */
    private fun drafts(router: Router) {
        val base = "/api/v1/user/projects/:project/drafts"
        onProject(router, "GET", base, VIEW) { call, project -> draft(call, project, "list") }
        onProject(router, "GET", "$base/:draft", VIEW) { call, project -> draft(call, project, "read", "draft_id" to call.params["draft"]) }
        onProject(router, "GET", "$base/:draft/blobs/:hash", VIEW) { call, project ->
            val hash = call.params.getValue("hash").takeIf { SHA256.matches(it) } ?: return@onProject call.error(422, "invalid_input")
            draftReply(call, project, "read_blob", "draft_id" to call.params["draft"], "hash" to hash) { reply ->
                val content = reply["content_base64"] as? String
                if (ok(reply) && content != null) Base64.getDecoder().decode(content).let { call.send(200, "application/octet-stream", it, cacheFor(it, hash)) }
                else draftResponse(call, project, reply)
            }
        }
        onProject(router, "POST", base, EDIT) { call, project ->
            val request = call.body()
            val id = request?.get("id")?.takeIf { it.isTextual && IDENTIFIER.matches(it.asText()) }?.asText()
            val operationId = request?.let(::operationId)
            if (id == null || operationId == null || !request.path("snapshot").isObject) return@onProject call.error(422, "invalid_input")
            draft(call, project, "create", "draft_id" to id, "operation_id" to operationId, "name" to request["name"], "snapshot" to request["snapshot"], created = true)
        }
        onProject(router, "PUT", "$base/:draft", EDIT) { call, project ->
            revised(call) { request, revision, operationId ->
                if (!request.path("snapshot").isObject) return@revised call.error(422, "invalid_input")
                draft(
                    call, project, "update", "draft_id" to call.params["draft"], "expected_revision" to revision,
                    "operation_id" to operationId, "name" to request["name"], "snapshot" to request["snapshot"],
                )
            }
        }
        onProject(router, "DELETE", "$base/:draft", EDIT) { call, project ->
            revised(call) { _, revision, operationId ->
                draft(call, project, "discard", "draft_id" to call.params["draft"], "expected_revision" to revision, "operation_id" to operationId)
            }
        }
        onProject(router, "POST", "$base/:draft/publish", PUBLISH) { call, project ->
            revised(call) { _, revision, operationId ->
                draft(call, project, "publish", "draft_id" to call.params["draft"], "expected_revision" to revision, "operation_id" to operationId)
            }
        }
        onProject(router, "POST", "$base/:draft/blobs", EDIT) { call, project ->
            revised(call) { request, revision, operationId ->
                val hash = request["hash"]?.asText()?.takeIf { SHA256.matches(it) }
                val content = request["contentBase64"]?.takeIf { it.isTextual }?.asText()
                if (hash == null || content == null) return@revised call.error(422, "invalid_input")
                draft(
                    call, project, "write_blob", "draft_id" to call.params["draft"], "expected_revision" to revision,
                    "operation_id" to operationId, "hash" to hash, "content_base64" to content,
                )
            }
        }
    }

    private fun revised(call: Call, then: (JsonNode, Int, String) -> Unit) {
        val request = call.body()
        val revision = request?.get("revision")?.takeIf { it.canConvertToInt() && it.isIntegralNumber }?.intValue()
        val operationId = request?.let(::operationId)
        if (revision == null || revision < 1 || operationId == null) return call.error(422, "invalid_input")
        then(request, revision, operationId)
    }

    private fun draftMessage(call: Call, project: ProjectRef, action: String, vararg fields: Pair<String, Any?>) = mapOf(
        "type" to "project_draft_request",
        "project_id" to project.folder,
        "owner_id" to call.session!!.playerId.toString(),
        "action" to action,
    ) + author(call) + fields

    /** The Version a publication makes is authored by the signed-in player. */
    private fun author(call: Call) = call.session!!.let { mapOf("author_id" to it.playerId.toString(), "author_name" to it.playerName) }

    private fun draft(call: Call, project: ProjectRef, action: String, vararg fields: Pair<String, Any?>, created: Boolean = false) {
        draftReply(call, project, action, *fields) { reply -> draftResponse(call, project, reply, created) }
    }

    /** A draft operation's reply: done by the hub on the database, or by the server when there is none. */
    private fun draftReply(call: Call, project: ProjectRef, action: String, vararg fields: Pair<String, Any?>, respond: (Map<String, Any?>) -> Unit) {
        val message = draftMessage(call, project, action, *fields)
        val drafts = drafts ?: return relay.send(call, project.server, message, respond)
        val request = Call.mapper.valueToTree<com.fasterxml.jackson.databind.node.ObjectNode>(message)
        drafts.handle(project.server.id, project.folder, request, { publication, reply -> relay.send(call, project.server, publication, reply) }) { reply ->
            // A refusal the editor cannot recover from on its own: one line for post-mortem.
            if (reply["ok"] == false && reply["error"] !in EXPECTED_DRAFT_ERRORS)
                logger?.warning("[Artisan] Draft $action on ${project.id} refused: ${reply["error"]}${reply["message"]?.let { " ($it)" } ?: ""}")
            respond(reply)
        }
    }

    private fun draftResponse(call: Call, project: ProjectRef, reply: Map<String, Any?>, created: Boolean = false) {
        val projectId = project.id
        @Suppress("UNCHECKED_CAST")
        fun attach(draft: Any?) = (draft as? Map<String, Any?>)?.plus("projectId" to projectId) ?: draft
        val body = (reply - setOf("type", "request_id")).toMutableMap()
        if (reply["draft"] != null) body["draft"] = attach(reply["draft"])
        (reply["drafts"] as? List<*>)?.let { drafts -> body["drafts"] = drafts.map(::attach) }
        if (ok(reply)) return call.json(body, if (created) 201 else 200)
        val status = when (errorCode(reply)) {
            "not_found" -> 404
            "draft_migration_pending", "storage_error", "rename_in_progress", "rename_pending",
            "inventory_unavailable", "plugin_update_required" -> 503
            "draft_conflict", "draft_exists", "draft_closed", "conflict" -> 409
            in OPERATION_ERRORS -> 409
            else -> 422
        }
        call.json(body, status)
    }

    private fun operationId(request: JsonNode): String? {
        val value = request["operationId"] ?: return UUID.randomUUID().toString()
        return value.asText().takeIf { value.isTextual && IDENTIFIER.matches(it) }
    }

    @Suppress("UNCHECKED_CAST")
    private fun roots(reply: Map<String, Any?>) = (reply["project_roots"] as? List<Map<String, Any?>>).orEmpty()

    private fun summary(server: EditorServer, root: Map<String, Any?>): Map<String, Any?> {
        val folder = root["project_id"] as String
        val id = ProjectRef.id(server.id, folder)
        return mapOf(
            "id" to id, "name" to folder, "externalId" to folder, "slug" to id,
            "networkId" to LOCAL, "serverKeyId" to server.uuid, "hash" to "",
            "identityKind" to root["identity"], "ownerModule" to root["module_id"], "projectKey" to root["project_key"],
            "capabilities" to mapOf("canRename" to movable(server, root)),
        )
    }

    private fun contentType(path: String) = when (path.substringAfterLast('.', "").lowercase()) {
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "ttf" -> "font/ttf"
        "otf" -> "font/otf"
        "ogg" -> "audio/ogg"
        "zip" -> "application/zip"
        else -> "application/octet-stream"
    }

    companion object {
        private val EXPECTED_DRAFT_ERRORS = setOf("draft_conflict", "conflict", "draft_closed", "not_found")
        private val OPERATION_ERRORS = setOf("operation_mismatch", "operation_conflict", "operation_expired")
        private val IDENTIFIER = Regex("[a-zA-Z0-9_-]{1,100}")
        private val SHA256 = Regex("[a-f0-9]{64}")
    }
}
