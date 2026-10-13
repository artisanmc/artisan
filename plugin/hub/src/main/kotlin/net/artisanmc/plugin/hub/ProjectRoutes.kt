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
import java.util.Base64
import java.util.UUID

/**
 * Projects, publication et brouillons. L'identifiant d'un Project vient du nom de son
 * dossier ([Servers.project]) : sans base de données, c'est la seule identité qui existe.
 */
class ProjectRoutes(private val servers: Servers, private val relay: Relay) {
    fun register(router: Router) {
        router.on("GET", "$SERVER/projects", VIEW) { call ->
            val server = servers.of(call) ?: return@on call.error(404, "not_found")
            relay.send(call, server, mapOf("type" to "project_list")) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
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
            relay.send(call, server, mapOf("type" to "project_list")) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
                val root = roots(reply).firstOrNull { it["project_id"] == project.folder } ?: return@send call.error(404, "not_found")
                call.json(mapOf(
                    "project" to summary(server, root),
                    "networkId" to LOCAL,
                    "serverKeyId" to server.id,
                    "capabilities" to mapOf(
                        "liveData" to true, "captureInGame" to false, "preview" to true, "canRename" to false,
                        // Assistant et migration hors de l'éditeur auto-hébergé ; supprimer un Project passait par le backend.
                        "canUseAssistant" to false, "canDelete" to false, "canCopyToServer" to false,
                    ),
                    "minecraftVersion" to server.minecraftVersion,
                    "connection" to mapOf("available" to true),
                ))
            }
        }
        onProject(router, "GET", "/api/v1/projects/:project/editor-access", VIEW) { call, project ->
            relay.send(call, project.server, mapOf("type" to "project_list")) { reply ->
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
        // Les Versions sont l'historique que gardait le backend : rien à montrer sans lui.
        router.on("GET", "/api/v1/projects/:project/versions", VIEW) { it.json(mapOf("versions" to emptyList<Any>())) }
        router.on("GET", "/api/v1/projects/:project/versions/:version", VIEW) { it.error(404, "not_found") }

        drafts(router)
    }

    private fun onProject(router: Router, method: String, pattern: String, permission: String, handler: (Call, ProjectRef) -> Unit) {
        router.on(method, pattern, permission) { call ->
            val project = servers.projectOf(call) ?: return@on call.error(404, "not_found")
            handler(call, project)
        }
    }

    private fun read(call: Call, project: ProjectRef) {
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
        relay.send(call, project.server, mapOf("type" to "project_history", "project_id" to project.folder, "path" to path)) { reply ->
            if (ok(reply)) call.json(mapOf("versions" to reply["versions"])) else readError(call, reply)
        }
    }

    private fun asset(call: Call, project: ProjectRef) {
        val path = call.query("path") ?: return call.error(422, "invalid_input")
        relay.send(call, project.server, mapOf("type" to "asset_read", "project_id" to project.folder, "path" to path)) { reply ->
            val content = reply["content_base64"] as? String
            if (!ok(reply) || content == null) return@send readError(call, reply)
            call.send(200, contentType(path), Base64.getDecoder().decode(content), "private, no-cache")
        }
    }

    /** Les brouillons privés restent sur le disque du serveur (`ProjectDraftStore`), un jeu par joueur. */
    private fun drafts(router: Router) {
        val base = "/api/v1/user/projects/:project/drafts"
        onProject(router, "GET", base, VIEW) { call, project -> draft(call, project, "list") }
        onProject(router, "GET", "$base/:draft", VIEW) { call, project -> draft(call, project, "read", "draft_id" to call.params["draft"]) }
        onProject(router, "GET", "$base/:draft/blobs/:hash", VIEW) { call, project ->
            val hash = call.params.getValue("hash").takeIf { SHA256.matches(it) } ?: return@onProject call.error(422, "invalid_input")
            val message = draftMessage(call, project, "read_blob", "draft_id" to call.params["draft"], "hash" to hash)
            relay.send(call, project.server, message) { reply ->
                val content = reply["content_base64"] as? String
                if (ok(reply) && content != null) call.send(200, "application/octet-stream", Base64.getDecoder().decode(content))
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
    ) + fields

    private fun draft(call: Call, project: ProjectRef, action: String, vararg fields: Pair<String, Any?>, created: Boolean = false) {
        relay.send(call, project.server, draftMessage(call, project, action, *fields)) { reply -> draftResponse(call, project, reply, created) }
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
            "quota_denied" -> 403
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
            "id" to id, "name" to folder, "externalId" to id, "slug" to id,
            "networkId" to LOCAL, "serverKeyId" to server.id, "hash" to "",
            "identityKind" to root["identity"], "ownerModule" to root["module_id"],
            "capabilities" to mapOf("canRename" to false),
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
        private val OPERATION_ERRORS = setOf("operation_mismatch", "operation_conflict", "operation_expired")
        private val IDENTIFIER = Regex("[a-zA-Z0-9_-]{1,100}")
        private val SHA256 = Regex("[a-f0-9]{64}")
    }
}
