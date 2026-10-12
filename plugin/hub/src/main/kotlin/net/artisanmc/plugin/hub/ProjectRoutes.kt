package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.plugin.hub.AccountRoutes.Companion.LOCAL
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
 * Projects, publication et brouillons. L'identifiant d'un Project est le nom de son dossier :
 * sans base de données, c'est la seule identité qui existe.
 */
class ProjectRoutes(private val server: LocalServer, private val relay: Relay) {
    fun register(router: Router) {
        router.on("GET", "$SERVER/projects", VIEW) { call ->
            if (!local(call)) return@on
            relay.send(call, mapOf("type" to "project_list")) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
                call.json(mapOf(
                    "project_ids" to reply["project_ids"],
                    "projects" to roots(reply).map(::summary),
                    "pending_renames" to emptyList<Any>(),
                ))
            }
        }
        router.on("GET", "/api/v1/user/projects/:project", VIEW) { call ->
            val projectId = call.params.getValue("project")
            relay.send(call, mapOf("type" to "project_list")) { reply ->
                if (!ok(reply)) return@send readError(call, reply)
                val root = roots(reply).firstOrNull { it["project_id"] == projectId } ?: return@send call.error(404, "not_found")
                call.json(mapOf(
                    "project" to summary(root),
                    "networkId" to LOCAL,
                    "serverKeyId" to LOCAL,
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
        router.on("GET", "/api/v1/projects/:project/editor-access", VIEW) { call ->
            relay.send(call, mapOf("type" to "project_list")) { reply ->
                val root = roots(reply).firstOrNull { it["project_id"] == call.params["project"] }
                val origin = if (root?.get("identity") == "addon") "module" else "personal"
                call.json(EDITOR_ACCESS + ("projectOrigin" to origin))
            }
        }

        for (base in listOf("/api/v1/projects/:project", "$SERVER/projects/:project")) {
            router.on("GET", "$base/files", VIEW) { call -> if (local(call)) read(call) }
            router.on("PUT", "$base/files", PUBLISH) { call -> if (local(call)) write(call) }
            router.on("GET", "$base/history", VIEW) { call -> if (local(call)) history(call) }
        }
        router.on("GET", "/api/v1/projects/:project/binary", VIEW) { call -> asset(call) }
        router.on("GET", "$SERVER/projects/:project/asset", VIEW) { call -> if (local(call)) asset(call) }
        // Les Versions sont l'historique que gardait le backend : rien à montrer sans lui.
        router.on("GET", "/api/v1/projects/:project/versions", VIEW) { it.json(mapOf("versions" to emptyList<Any>())) }
        router.on("GET", "/api/v1/projects/:project/versions/:version", VIEW) { it.error(404, "not_found") }

        drafts(router)
    }

    private fun read(call: Call) {
        val message = mapOf("type" to "project_read", "project_id" to call.params["project"], "if_hash" to call.query("if_hash"))
        relay.send(call, message) { reply -> if (ok(reply)) call.json(body(reply)) else readError(call, reply) }
    }

    private fun write(call: Call) {
        val request = call.body()
        if (request == null || !request.path("files").isArray) return call.error(422, "invalid_input")
        val operationId = operationId(request) ?: return call.error(422, "invalid_input")
        val message = buildMap<String, Any?> {
            put("type", "project_write")
            put("project_id", call.params["project"])
            put("operation_id", operationId)
            put("files", request["files"])
            put("deletes", request["deletes"] ?: emptyList<Any>())
            put("renames", request["renames"] ?: emptyList<Any>())
            put("create", request.path("create").asBoolean(false))
            request["binaries"]?.let { put("binaries", it) }
        }
        relay.send(call, message) { reply ->
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

    private fun history(call: Call) {
        val path = call.query("path") ?: return call.error(422, "invalid_input")
        relay.send(call, mapOf("type" to "project_history", "project_id" to call.params["project"], "path" to path)) { reply ->
            if (ok(reply)) call.json(mapOf("versions" to reply["versions"])) else readError(call, reply)
        }
    }

    private fun asset(call: Call) {
        val path = call.query("path") ?: return call.error(422, "invalid_input")
        relay.send(call, mapOf("type" to "asset_read", "project_id" to call.params["project"], "path" to path)) { reply ->
            val content = reply["content_base64"] as? String
            if (!ok(reply) || content == null) return@send readError(call, reply)
            call.send(200, contentType(path), Base64.getDecoder().decode(content), "private, no-cache")
        }
    }

    /** Les brouillons privés restent sur le disque du serveur (`ProjectDraftStore`), un jeu par joueur. */
    private fun drafts(router: Router) {
        val base = "/api/v1/user/projects/:project/drafts"
        router.on("GET", base, VIEW) { call -> draft(call, "list") }
        router.on("GET", "$base/:draft", VIEW) { call -> draft(call, "read", "draft_id" to call.params["draft"]) }
        router.on("GET", "$base/:draft/blobs/:hash", VIEW) { call ->
            val hash = call.params.getValue("hash").takeIf { SHA256.matches(it) } ?: return@on call.error(422, "invalid_input")
            val message = draftMessage(call, "read_blob", "draft_id" to call.params["draft"], "hash" to hash)
            relay.send(call, message) { reply ->
                val content = reply["content_base64"] as? String
                if (ok(reply) && content != null) call.send(200, "application/octet-stream", Base64.getDecoder().decode(content))
                else draftResponse(call, reply)
            }
        }
        router.on("POST", base, EDIT) { call ->
            val request = call.body()
            val id = request?.get("id")?.takeIf { it.isTextual && IDENTIFIER.matches(it.asText()) }?.asText()
            val operationId = request?.let(::operationId)
            if (id == null || operationId == null || !request.path("snapshot").isObject) return@on call.error(422, "invalid_input")
            draft(call, "create", "draft_id" to id, "operation_id" to operationId, "name" to request["name"], "snapshot" to request["snapshot"], created = true)
        }
        router.on("PUT", "$base/:draft", EDIT) { call ->
            revised(call) { request, revision, operationId ->
                if (!request.path("snapshot").isObject) return@revised call.error(422, "invalid_input")
                draft(
                    call, "update", "draft_id" to call.params["draft"], "expected_revision" to revision,
                    "operation_id" to operationId, "name" to request["name"], "snapshot" to request["snapshot"],
                )
            }
        }
        router.on("DELETE", "$base/:draft", EDIT) { call ->
            revised(call) { _, revision, operationId ->
                draft(call, "discard", "draft_id" to call.params["draft"], "expected_revision" to revision, "operation_id" to operationId)
            }
        }
        router.on("POST", "$base/:draft/publish", PUBLISH) { call ->
            revised(call) { _, revision, operationId ->
                draft(call, "publish", "draft_id" to call.params["draft"], "expected_revision" to revision, "operation_id" to operationId)
            }
        }
        router.on("POST", "$base/:draft/blobs", EDIT) { call ->
            revised(call) { request, revision, operationId ->
                val hash = request["hash"]?.asText()?.takeIf { SHA256.matches(it) }
                val content = request["contentBase64"]?.takeIf { it.isTextual }?.asText()
                if (hash == null || content == null) return@revised call.error(422, "invalid_input")
                draft(
                    call, "write_blob", "draft_id" to call.params["draft"], "expected_revision" to revision,
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

    private fun draftMessage(call: Call, action: String, vararg fields: Pair<String, Any?>) = mapOf(
        "type" to "project_draft_request",
        "project_id" to call.params["project"],
        "owner_id" to call.session!!.playerId.toString(),
        "action" to action,
    ) + fields

    private fun draft(call: Call, action: String, vararg fields: Pair<String, Any?>, created: Boolean = false) {
        relay.send(call, draftMessage(call, action, *fields)) { reply -> draftResponse(call, reply, created) }
    }

    private fun draftResponse(call: Call, reply: Map<String, Any?>, created: Boolean = false) {
        val projectId = call.params["project"]
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

    private fun local(call: Call): Boolean {
        val scoped = call.params.containsKey("network")
        if (scoped && (call.params["network"] != LOCAL || call.params["server"] != LOCAL)) {
            call.error(404, "not_found")
            return false
        }
        return true
    }

    private fun operationId(request: JsonNode): String? {
        val value = request["operationId"] ?: return UUID.randomUUID().toString()
        return value.asText().takeIf { value.isTextual && IDENTIFIER.matches(it) }
    }

    @Suppress("UNCHECKED_CAST")
    private fun roots(reply: Map<String, Any?>) = (reply["project_roots"] as? List<Map<String, Any?>>).orEmpty()

    private fun summary(root: Map<String, Any?>): Map<String, Any?> {
        val id = root["project_id"] as String
        return mapOf(
            "id" to id, "name" to id, "externalId" to id, "slug" to id,
            "networkId" to LOCAL, "serverKeyId" to LOCAL, "hash" to "",
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
