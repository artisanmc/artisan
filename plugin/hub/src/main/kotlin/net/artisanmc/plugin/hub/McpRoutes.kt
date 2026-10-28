package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.logging.Level
import java.util.logging.Logger

/**
 * `POST /mcp`: the Model Context Protocol over Streamable HTTP, stateless, JSON answers only
 * (ADR `mcp-server`). The caller is a client the player approved (`Authorization: Bearer`, see
 * [OAuthRoutes]) or, from the editor's own page, its session cookie. Both need
 * `artisan.editor.edit`, read again on every call.
 */
class McpRoutes(
    private val tools: McpTools,
    private val grants: McpGrants,
    private val version: String = "",
    private val logger: Logger? = null,
    /** The tools block on server replies: on threads of their own, never the web server's. */
    private val executor: ExecutorService = Executors.newFixedThreadPool(4) { r -> Thread(r, "artisan-mcp").apply { isDaemon = true } },
) {
    fun register(router: Router) {
        router.on("POST", PATH, null, crossOrigin = true, ::post)
        // No server-sent stream and no session to end: stateless (Streamable HTTP, §2.2.3 and §2.5).
        for (method in listOf("GET", "DELETE")) router.on(method, PATH, null, crossOrigin = true) { call ->
            OAuthRoutes.cors(call)
            call.addHeader("Allow", "POST")
            call.error(405, "method_not_allowed")
        }
        router.on("OPTIONS", PATH, null, crossOrigin = true, OAuthRoutes::preflight)
    }

    private fun post(call: Call) {
        OAuthRoutes.cors(call)
        val principal = principal(call) ?: return
        val body = call.bytes(MAX_BODY)?.let { runCatching { Call.mapper.readTree(it) }.getOrNull() }
            ?: return call.json(error(null, PARSE_ERROR, "Parse error"), 400)
        executor.execute {
            try {
                if (body.isArray) {
                    val answers = body.mapNotNull { answer(principal, it) }
                    if (answers.isEmpty()) call.send(202, "application/json", ByteArray(0)) else call.json(answers)
                } else {
                    answer(principal, body)?.let(call::json) ?: call.send(202, "application/json", ByteArray(0))
                }
            } catch (e: Exception) {
                logger?.log(Level.WARNING, "[Artisan] MCP request failed", e)
                call.json(error(body.get("id"), INTERNAL_ERROR, "Internal error"), 500)
            }
        }
    }

    /** The caller, or null once refused: 401 asks for a token, as RFC 9728 says where to get one. */
    private fun principal(call: Call): McpPrincipal? {
        val bearer = call.header("Authorization")?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }?.substring(7)?.trim()
        val principal = when {
            bearer != null -> grants.authenticate(bearer)?.let { McpPrincipal(it.playerId, it.playerName, it.permissions, it.id, it.clientName) }
            else -> call.session?.let { McpPrincipal(it.playerId, it.playerName, it.permissions - EditorPermissions.PUBLISH - EditorPermissions.CONFIG) }
        }
        if (principal == null) {
            val metadata = "${OAuthRoutes.base(call)}${OAuthRoutes.RESOURCE_METADATA}"
            call.addHeader("WWW-Authenticate", "Bearer resource_metadata=\"$metadata\"" + if (bearer != null) ", error=\"invalid_token\"" else "")
            call.error(401, "unauthorized")
            return null
        }
        if (!principal.can(EditorPermissions.EDIT)) {
            call.addHeader("WWW-Authenticate", "Bearer error=\"insufficient_scope\", error_description=\"artisan.editor.edit is required\"")
            call.error(403, "forbidden", "The player lacks ${EditorPermissions.EDIT}.")
            return null
        }
        return principal
    }

    /** One JSON-RPC message's answer; null for a notification, which gets none. */
    private fun answer(principal: McpPrincipal, message: JsonNode): Map<String, Any?>? {
        val id = message.get("id")
        val method = message.get("method")?.takeIf { it.isTextual }?.asText()
        if (!message.isObject || message.path("jsonrpc").asText() != "2.0") return error(id, INVALID_REQUEST, "Invalid request")
        if (method == null) return null // a response to a request this server never sends
        if (id == null || id.isNull) return null
        val params = message.path("params")
        return when (method) {
            "initialize" -> result(id, initialize(params))
            "ping" -> result(id, emptyMap<String, Any>())
            "tools/list" -> result(id, mapOf("tools" to tools.tools.map(::describe)))
            "tools/call" -> call(principal, id, params)
            else -> error(id, METHOD_NOT_FOUND, "Method not found: $method")
        }
    }

    private fun initialize(params: JsonNode): Map<String, Any?> {
        val asked = params.path("protocolVersion").asText("")
        return mapOf(
            "protocolVersion" to if (asked in PROTOCOL_VERSIONS) asked else PROTOCOL_VERSIONS.first(),
            "capabilities" to mapOf("tools" to mapOf("listChanged" to false)),
            "serverInfo" to mapOf("name" to "artisan", "title" to "Artisan", "version" to version.ifEmpty { "dev" }),
            "instructions" to INSTRUCTIONS,
        )
    }

    private fun describe(tool: McpTools.Tool) = mapOf(
        "name" to tool.name,
        "title" to tool.title,
        "description" to tool.description,
        "inputSchema" to tool.input,
        "annotations" to mapOf("readOnlyHint" to tool.readOnly, "destructiveHint" to false, "openWorldHint" to false),
    )

    private fun call(principal: McpPrincipal, id: JsonNode, params: JsonNode): Map<String, Any?> {
        val name = params.path("name").asText("")
        val tool = tools.find(name) ?: return error(id, INVALID_PARAMS, "Unknown tool: $name")
        val args = params.path("arguments").takeIf { it.isObject } ?: Call.mapper.createObjectNode()
        if (!tool.readOnly) logger?.info("[Artisan] MCP ${principal.clientName ?: "editor"} for ${principal.playerName}: $name ${args.path("path").asText("")}".trimEnd())
        val outcome = tools.invoke(principal, tool, args)
        return result(id, content(outcome.body, outcome.error))
    }

    /**
     * A tool result: the JSON as text for any client, and as `structuredContent` for those that read it.
     * A tool that answers in prose (get_kind_guide) is sent as it is.
     */
    private fun content(body: Any?, error: Boolean): Map<String, Any?> = buildMap {
        put("content", listOf(mapOf("type" to "text", "text" to McpTools.resultText(body))))
        if (body is Map<*, *>) put("structuredContent", body)
        if (error) put("isError", true)
    }

    private fun result(id: JsonNode, result: Any?) = mapOf("jsonrpc" to "2.0", "id" to id, "result" to result)

    private fun error(id: JsonNode?, code: Int, message: String) =
        mapOf("jsonrpc" to "2.0", "id" to id, "error" to mapOf("code" to code, "message" to message))

    companion object {
        const val PATH = "/mcp"
        /** Newest first: the one answered when the client asks for another. */
        val PROTOCOL_VERSIONS = listOf("2025-11-25", "2025-06-18", "2025-03-26")
        const val MAX_BODY = 4 * 1024 * 1024
        const val PARSE_ERROR = -32700
        const val INVALID_REQUEST = -32600
        const val METHOD_NOT_FOUND = -32601
        const val INVALID_PARAMS = -32602
        const val INTERNAL_ERROR = -32603

        const val INSTRUCTIONS = "Artisan builds Minecraft menus, commands, dialogs and triggers from YAML Documents. " +
            "Call artisan_overview first. You write into a private draft (start_draft, write_document); each file is checked by " +
            "the server before it enters the draft. The player reviews the draft in the Artisan editor and deploys it there: " +
            "you cannot deploy, and nothing reaches players before they do."
    }
}
