package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.plugin.model.DocumentLayout
import net.artisanmc.plugin.project.ProjectMetadataPaths
import net.artisanmc.plugin.project.ProjectPathPolicy
import java.util.UUID

/**
 * The six tools of the MCP endpoint (ADR `mcp-server`). Three read, three prepare a draft;
 * none deploys. A model works in a draft of the player's, which the player opens in the editor,
 * reviews, then deploys with the editor's own button: the only write to the server's disk.
 */
class McpTools(private val projects: McpProjects, private val editorUrl: () -> String = { "" }) {
    /** A tool as `tools/list` describes it, and what it does. */
    class Tool(val name: String, val title: String, val description: String, val input: Map<String, Any?>, val readOnly: Boolean, val run: (McpPrincipal, JsonNode) -> Any?)

    val tools: List<Tool> = listOf(
        Tool(
            "artisan_overview", "Artisan overview",
            "Start here. Lists the Minecraft servers of this Artisan network, their Projects, and the Document kinds each server " +
                "understands (menus, commands, dialogs, triggers, module kinds). Explains the workflow: start_draft, then write_document; " +
                "the player reviews the draft in the Artisan editor and deploys it there. Nothing you write reaches the server before that.",
            schema(), readOnly = true, ::overview,
        ),
        Tool(
            "list_documents", "List documents",
            "Lists the files of a Project, as the server loaded them, or as a draft has them when draft_id is given: each Document with " +
                "its kind, the other files (translations under lang/, data), and the files the server could not load with the reason.",
            schema("project" to PROJECT, "draft_id" to DRAFT_OPTIONAL), readOnly = true, ::listDocuments,
        ),
        Tool(
            "read_document", "Read a document",
            "Reads one file of a Project (YAML text), as deployed, or as a draft has it when draft_id is given.",
            schema("project" to PROJECT, "path" to PATH, "draft_id" to DRAFT_OPTIONAL, required = listOf("project", "path")), readOnly = true, ::readDocument,
        ),
        Tool(
            "get_kind_guide", "Document kind guide",
            "How to write a Document of one kind: where it goes (<kind dir>/<id>.yml), the `schema:` label to put first, an outline " +
                "of its fields, actions and conditions, the actions this server's modules add, and how texts are translated. Pass project " +
                "to also get the Project's languages and an existing Document of that kind as an example. " +
                "detail: \"schema\" returns the full JSON schema every file is checked against instead of the outline.",
            schema(
                "kind" to string("A Document kind from artisan_overview: menu, command, dialog, trigger…"), "project" to PROJECT_OPTIONAL,
                "detail" to mapOf("type" to "string", "enum" to listOf("outline", "schema"), "description" to "outline (default) or schema."),
                required = listOf("kind"),
            ),
            readOnly = true, ::kindGuide,
        ),
        Tool(
            "start_draft", "Start a draft",
            "Creates a private draft of a Project for the signed-in player, from what the server runs now. Every write_document goes " +
                "into a draft. The player sees it in the editor's Drafts list, reviews the changes, and deploys them; you cannot deploy.",
            schema("project" to PROJECT, "name" to string("A short name the player recognises in their Drafts list, e.g. \"AI: shop menu\"."), required = listOf("project", "name")),
            readOnly = false, ::startDraft,
        ),
        Tool(
            "write_document", "Write a document in a draft",
            "Writes (or, with delete: true, removes) one file in a draft. The file is checked by the Project's server first (path, YAML, " +
                "JSON schema, engine load): when a check fails, the draft is left unchanged and the problems come back, to fix and retry. " +
                "Write the whole file, not a patch.",
            schema(
                "project" to PROJECT, "draft_id" to string("The draft from start_draft."), "path" to PATH,
                "content" to string("The file's full YAML text."), "delete" to mapOf("type" to "boolean", "description" to "Remove the file instead."),
                required = listOf("project", "draft_id", "path"),
            ),
            readOnly = false, ::writeDocument,
        ),
    )

    fun find(name: String): Tool? = tools.firstOrNull { it.name == name }

    /** A tool call's answer as a model reads it: the MCP endpoint and the editor's assistant both hand it on. */
    class Outcome(val body: Any?, val error: Boolean)

    fun invoke(principal: McpPrincipal, tool: Tool, args: JsonNode): Outcome = try {
        when (val out = tool.run(principal, args)) {
            is Refused -> Outcome(out.body, error = true)
            else -> Outcome(out, error = false)
        }
    } catch (e: McpRefusal) {
        Outcome(mapOf("error" to e.code, "message" to e.message), error = true)
    }

    private fun overview(principal: McpPrincipal, args: JsonNode): Any {
        val servers = projects.servers().map { server ->
            val announcement = runCatching { server.announcement() }.getOrNull()
            val listed = runCatching { projects.list(server) }
            val folders = listed.getOrNull()?.let { (it["project_ids"] as? List<*>)?.map(Any?::toString) }
            buildMap {
                put("id", server.id)
                put("name", server.label)
                put("online", server.online)
                put("minecraft_version", server.minecraftVersion)
                put("projects", folders?.map { ProjectRef.id(server.id, it) } ?: emptyList<String>())
                listed.exceptionOrNull()?.let { put("projects_unavailable", it.message) }
                put("document_kinds", announcement?.documentKinds?.map { mapOf("kind" to it["kind"], "dir" to it["dir"], "schema" to (it["schema_versions"] as? List<*>)?.firstOrNull()) } ?: emptyList<Any>())
                put("modules", announcement?.modules?.mapNotNull { it["id"] } ?: emptyList<Any>())
            }
        }
        return mapOf(
            "player" to principal.playerName,
            "can_write_drafts" to principal.can(EditorPermissions.EDIT),
            "servers" to servers,
            "workflow" to listOf(
                "1. Pick a Project. Read what exists with list_documents and read_document.",
                "2. Before writing a kind you have not written yet, call get_kind_guide for it.",
                "3. start_draft once per piece of work, then write_document for each file; fix what the checks report.",
                "4. Tell the player the draft's name: they open it in the editor (Drafts), review, and click Deploy. You never deploy.",
                "Visible text goes in the Document as written; references to other Documents use their id, e.g. `open_menu shop`.",
            ),
            "editor_url" to editorUrl().ifEmpty { null },
        )
    }

    private fun listDocuments(principal: McpPrincipal, args: JsonNode): Any {
        val project = projects.project(text(args, "project"))
        val draftId = args.path("draft_id").asText("").ifEmpty { null }
        val read = projects.read(project)
        val tree = draftId?.let { draftSnapshot(principal, project, it).tree } ?: files(read)
        val kinds = kinds(project.server)
        val layout = DocumentLayout.classify(tree.keys, kinds.keys)
        val documents = layout.documents.map { mapOf("path" to it.path, "kind" to kinds[it.dir], "id" to it.id) }
        val listed = documents.map { it["path"] }.toSet()
        @Suppress("UNCHECKED_CAST")
        val failed = (read["failed"] as? List<Map<String, Any?>>).orEmpty()
        val drafts = runCatching { projects.draft(principal, project, "list") }.getOrNull()
            ?.let { (it["drafts"] as? List<*>)?.filterIsInstance<Map<*, *>>() }
            ?.map { mapOf("draft_id" to it["id"], "name" to it["name"], "revision" to it["revision"], "source" to it["source"], "updated_at" to it["updatedAt"]) }
        return mapOf(
            "project" to project.id,
            "draft_id" to draftId,
            "documents" to documents,
            "other_files" to tree.keys.filter { it !in listed }.sorted(),
            "not_loaded" to if (draftId == null) failed else emptyList(),
            "your_drafts" to drafts,
        )
    }

    private fun readDocument(principal: McpPrincipal, args: JsonNode): Any {
        val project = projects.project(text(args, "project"))
        val path = path(args)
        val draftId = args.path("draft_id").asText("").ifEmpty { null }
        val tree = if (draftId != null) draftSnapshot(principal, project, draftId).tree else files(projects.read(project))
        val content = tree[path] ?: throw McpRefusal("not_found", "No file '$path' in ${if (draftId != null) "draft $draftId" else project.id}.")
        return mapOf("project" to project.id, "path" to path, "draft_id" to draftId, "content" to content)
    }

    private fun kindGuide(principal: McpPrincipal, args: JsonNode): Any {
        val name = text(args, "kind")
        val full = args.path("detail").asText("") == "schema"
        val projectId = args.path("project").asText("").ifEmpty { null }
        val project = projectId?.let(projects::project)
        val server = project?.server ?: projects.servers().first()
        val kind = server.announcement().documentKinds.firstOrNull { it["kind"] == name }
            ?: throw McpRefusal("not_found", "No Document kind '$name' on ${server.label}. artisan_overview lists the kinds.")
        val dir = kind["dir"] as String
        val label = (kind["schema_versions"] as? List<*>)?.firstOrNull()?.toString().orEmpty()
        val schema = McpTools::class.java.getResourceAsStream("/schema/$label.json")?.use { Call.mapper.readTree(it) }
        val tree = project?.let { files(projects.read(it)) }
        val example = tree?.let { t ->
            DocumentLayout.classify(t.keys, setOf(dir)).documents.firstOrNull()?.let { it.path to t[it.path]!!.take(MAX_EXAMPLE) }
        }
        return KindGuide(name, kind, schema, server.announcement().actions, tree, example).render(full)
    }

    private fun startDraft(principal: McpPrincipal, args: JsonNode): Any {
        requireEdit(principal)
        val project = projects.project(text(args, "project"))
        val name = text(args, "name").trim().take(120)
        val read = projects.read(project)
        val tree = files(read)
        val binaries = (read["binaries"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()
            .filter { contentPath(it["path"].toString()) }
            .associate { it["path"].toString() to mapOf("hash" to it["hash"], "size" to it["size"]) }
        val snapshot = mapOf(
            "baseline" to tree, "tree" to tree, "initialTree" to tree,
            "binaryBaseline" to binaries, "binaryTree" to binaries,
            "at" to System.currentTimeMillis(),
        )
        val id = UUID.randomUUID().toString()
        val reply = projects.draft(
            principal, project, "create",
            "draft_id" to id, "operation_id" to UUID.randomUUID().toString(), "name" to name, "snapshot" to snapshot, "source" to SOURCE,
        )
        refuseDraft(reply)
        return mapOf(
            "project" to project.id, "draft_id" to id, "name" to name, "revision" to 1,
            "next" to "write_document into this draft, then tell the player to open \"$name\" in the editor's Drafts and deploy it.",
        )
    }

    private fun writeDocument(principal: McpPrincipal, args: JsonNode): Any {
        requireEdit(principal)
        val project = projects.project(text(args, "project"))
        val draftId = text(args, "draft_id")
        val path = path(args)
        val delete = args.path("delete").asBoolean(false)
        val content = if (delete) null else args.get("content")?.takeIf { it.isTextual }?.asText()
            ?: throw McpRefusal("invalid_input", "content is required, unless delete is true.")
        if (!contentPath(path)) throw McpRefusal("invalid_path", "'$path' is not a path a Project file can have.")
        if (content != null && content.length > MAX_FILE) throw McpRefusal("too_large", "A file is at most $MAX_FILE characters.")
        val draft = draftSnapshot(principal, project, draftId)
        if (delete && path !in draft.tree) throw McpRefusal("not_found", "No file '$path' in draft $draftId.")
        val tree = if (content == null) draft.tree - path else draft.tree + (path to content)
        // The whole draft is checked as one Project: a menu may name a command written just before.
        val changed = tree.filter { (p, text) -> draft.baseline[p] != text }
        val deleted = draft.baseline.keys - tree.keys
        val problems = projects.check(project, changed, deleted)
        val own = problems.filter { it["path"] == path }
        if (own.isNotEmpty()) {
            return Refused(mapOf(
                "written" to false,
                "path" to path,
                "problems" to own,
                "hint" to "The draft is unchanged. Fix these problems and call write_document again; get_kind_guide has the schema.",
            ))
        }
        val snapshot = (draft.json.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>()).apply {
            set<JsonNode>("tree", Call.mapper.valueToTree(tree))
        }
        val reply = projects.draft(
            principal, project, "update",
            "draft_id" to draftId, "expected_revision" to draft.revision, "operation_id" to UUID.randomUUID().toString(),
            "name" to draft.name, "snapshot" to snapshot,
        )
        refuseDraft(reply)
        val others = problems.filter { it["path"] != path }
        return mapOf(
            "written" to true, "path" to path, "deleted" to delete, "draft_id" to draftId,
            "revision" to (reply["draft"] as? Map<*, *>)?.get("revision"),
            "other_problems" to others.ifEmpty { null },
        )
    }

    /** A tool's answer that is a refusal for the model to act on: `isError`, with what to fix. */
    class Refused(val body: Any)

    private class DraftSnapshot(val name: String, val revision: Long, val json: JsonNode, val baseline: Map<String, String>, val tree: Map<String, String>)

    private fun draftSnapshot(principal: McpPrincipal, project: ProjectRef, draftId: String): DraftSnapshot {
        val reply = projects.draft(principal, project, "read", "draft_id" to draftId)
        refuseDraft(reply)
        val draft = Call.mapper.valueToTree<JsonNode>(reply["draft"])
        if (draft.path("status").asText() != DraftStatus.ACTIVE.wire)
            throw McpRefusal("draft_closed", "Draft $draftId was deployed or discarded: start a new one.")
        val snapshot = draft.path("snapshot")
        fun texts(key: String): Map<String, String> =
            snapshot.path(key).fields().asSequence().filter { it.value.isTextual }.associate { it.key to it.value.asText() }
        return DraftSnapshot(draft.path("name").asText(), draft.path("revision").asLong(), snapshot, texts("baseline"), texts("tree"))
    }

    private fun refuseDraft(reply: Map<String, Any?>) {
        if (reply["ok"] == true) return
        val code = reply["error"] as? String ?: "storage_error"
        val message = when (code) {
            "draft_not_found" -> "No such draft of yours in this Project."
            "draft_conflict" -> "The draft changed meanwhile (the player edited it in the editor). Read it again and retry."
            "draft_closed" -> "This draft was deployed or discarded: start a new one."
            "unknown_project" -> "This Project is not recorded in the suite database yet."
            else -> (reply["message"] as? String) ?: code
        }
        throw McpRefusal(code, message)
    }

    private fun requireEdit(principal: McpPrincipal) {
        if (!principal.can(EditorPermissions.EDIT)) throw McpRefusal("forbidden", "The player lacks ${EditorPermissions.EDIT}: drafts cannot be written.")
    }

    /** The Project's text files the editor sees: what a draft's trees hold. */
    private fun files(read: Map<String, Any?>): Map<String, String> =
        (read["files"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()
            .mapNotNull { f -> (f["path"] as? String)?.takeIf(::contentPath)?.let { it to (f["content"] as? String).orEmpty() } }
            .toMap()

    /** Kind dir → kind, as [server] announces them. */
    private fun kinds(server: EditorServer): Map<String, String> =
        server.announcement().documentKinds.mapNotNull { k -> (k["dir"] as? String)?.let { it to k["kind"].toString() } }.toMap()

    private fun contentPath(path: String) = ProjectPathPolicy.valid(path) && !ProjectMetadataPaths.isHiddenFromEditor(path)

    private fun text(args: JsonNode, name: String): String =
        args.get(name)?.takeIf { it.isTextual && it.asText().isNotBlank() }?.asText()
            ?: throw McpRefusal("invalid_input", "$name is required.")

    private fun path(args: JsonNode) = text(args, "path").trim().removePrefix("/")

    companion object {
        /** A result as the model reads it: prose as it is, anything else as JSON, indented for an MCP client's reader. */
        fun resultText(body: Any?, indent: Boolean = true): String = body as? String
            ?: (if (indent) Call.mapper.writerWithDefaultPrettyPrinter() else Call.mapper.writer()).writeValueAsString(body)

        /** What a draft made through the MCP endpoint says it came from: the editor shows it. */
        private const val SOURCE = "ai"
        private const val MAX_FILE = 512 * 1024
        private const val MAX_EXAMPLE = 8000

        private val PROJECT = string("A Project id, `<server id>.<folder>`, from artisan_overview.")
        private val PROJECT_OPTIONAL = string("Optional: a Project id, for an example from it.")
        private val DRAFT_OPTIONAL = string("Optional: a draft id from start_draft, to read the draft instead of what is deployed.")
        private val PATH = string("A path in the Project, e.g. `menus/shop.yml` or `lang/en.yml`.")

        private fun string(description: String) = mapOf("type" to "string", "description" to description)

        private fun schema(vararg properties: Pair<String, Map<String, Any?>>, required: List<String> = properties.map { it.first }.filter { it == "project" }): Map<String, Any?> =
            mapOf("type" to "object", "properties" to properties.toMap(), "required" to required, "additionalProperties" to false)
    }
}
