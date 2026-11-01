package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.plugin.model.DocumentLayout
import net.artisanmc.plugin.model.ManifestYaml
import net.artisanmc.plugin.model.ModuleFile
import net.artisanmc.plugin.model.Originals
import net.artisanmc.plugin.project.ProjectMetadataPaths
import net.artisanmc.plugin.project.ProjectPathPolicy
import java.util.UUID

/**
 * The tools of the MCP endpoint (ADR `mcp-server`). Six read, two prepare a draft of the
 * player's, which the player opens in the editor, reviews and deploys. Two deploy, for an app
 * the player allowed to ([EditorPermissions.PUBLISH], off by default): `draft_publish` and
 * `version_rollback`, through the editor's own publication (compare-and-swap, the server's
 * checks), the Version attributed "<player> via <app>". A principal is offered only the tools
 * it may use ([available]).
 */
class McpTools(
    private val projects: McpProjects,
    private val editorUrl: () -> String = { "" },
    /** The hub's own pack build (Pro jar only): the resource pack tools; null, they are not offered. */
    private val packs: PackBuilder? = null,
) {
    /** A tool as `tools/list` describes it, and what it does. [requires]: the permission without which it is not offered. */
    class Tool(
        val name: String, val title: String, val description: String, val input: Map<String, Any?>, val readOnly: Boolean,
        val run: (McpPrincipal, JsonNode) -> Any?, val requires: String? = null, val destructive: Boolean = false,
    )

    val tools: List<Tool> = listOf(
        Tool(
            "artisan_overview", "Artisan overview",
            "Start here. Lists the Minecraft servers of this Artisan network, their Projects (the player calls them modules), and the " +
                "Document kinds each server understands (menus, commands, dialogs, triggers, add-on kinds). Explains the workflow: start_draft, then write_document; " +
                "the player reviews the draft and deploys it, in the Artisan editor or, when they allowed this app to, through draft_publish.",
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
            "read_docs", "Read Artisan's docs",
            "Artisan's user docs, as shipped with this server's release. Without page, the list of pages with their title and " +
                "description; with page, that page in Markdown. For what get_kind_guide leaves out: expressions in texts, data " +
                "sources, translations, commands and permissions, images and titles, add-on development.",
            schema("page" to string("Optional: a page path from the list, e.g. `editor/expressions`."), required = emptyList()),
            readOnly = true, ::readDocs,
        ),
        Tool(
            "create_module", "Create a module",
            "Creates a new, empty module on a server: a folder of Documents, which the player sees as a module in the editor (these " +
                "tools call it a Project). Only when the player asks for a new module; to add to an existing one, write into it. Nothing " +
                "reaches players until a draft of it is deployed: next, start_draft on its id, `<server id>.<name>`.",
            schema(
                "server" to string("A server id from artisan_overview."),
                "name" to string("The module's folder name: letters, digits, `_` and `-`, starting with a letter or a digit, e.g. `shop`."),
                required = listOf("server", "name"),
            ),
            readOnly = false, ::createModule, requires = EditorPermissions.PUBLISH,
        ),
        Tool(
            "start_draft", "Start a draft",
            "Creates a private draft of a Project for the signed-in player, from what the server runs now. Every write_document goes " +
                "into a draft. The player sees it in the editor's Drafts list, reviews the changes, and deploys them; nothing reaches " +
                "the server before.",
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
        Tool(
            "list_versions", "List versions",
            "The Versions of a Project, newest first: each deploy the server loaded, who published it (\"<player> via <app>\" for an AI " +
                "app), when, and the files it changed. version_rollback takes one of these numbers.",
            schema("project" to PROJECT, "limit" to mapOf("type" to "integer", "minimum" to 1, "maximum" to 50, "description" to "At most this many (default 10).")),
            readOnly = true, ::listVersions,
        ),
        Tool(
            "draft_publish", "Deploy a draft",
            "Deploys a draft to the Project's server, as the editor's Deploy button does: the server checks every file again and refuses " +
                "the deploy when its files changed since the draft started. Players see the change at once. Before calling it, show the " +
                "player the changes (dry_run: true returns the diff and the check without deploying) and get their explicit yes. The " +
                "answer carries the diff and the new Version's number; version_rollback with the previous Version undoes it.",
            schema(
                "project" to PROJECT, "draft_id" to string("The draft from start_draft."),
                "expected_revision" to mapOf("type" to "integer", "minimum" to 1, "description" to "The draft revision the player reviewed (from write_document or dry_run): a draft changed since is not deployed."),
                "dry_run" to mapOf("type" to "boolean", "description" to "Return the diff and the server's check, deploy nothing."),
                required = listOf("project", "draft_id", "expected_revision"),
            ),
            readOnly = false, ::draftPublish, requires = EditorPermissions.PUBLISH, destructive = true,
        ),
        Tool(
            "version_rollback", "Roll back to a version",
            "Deploys an earlier Version of a Project again, files and images, as the editor's Restore and deploy does. The new Version " +
                "says it was restored from that one. Get the player's explicit yes first. expected_version is the newest Version you " +
                "showed them (list_versions): when another deploy came since, nothing is rolled back.",
            schema(
                "project" to PROJECT, "version" to string("The Version to bring back, from list_versions."),
                "expected_version" to string("The newest Version now, from list_versions."),
                required = listOf("project", "version", "expected_version"),
            ),
            readOnly = false, ::versionRollback, requires = EditorPermissions.PUBLISH, destructive = true,
        ),
    ) + packTools()

    /** The resource pack tools, when this hub builds packs ([packs]). */
    private fun packTools(): List<Tool> = if (packs == null) emptyList() else listOf(
        Tool(
            "resource_pack_status", "Resource pack status",
            "What the hub last built for a server's resource packs: the Java pack's SHA-1 (Pro), the SHA-1 of the Java pack the " +
                "editor last uploaded, whether the two match, the Bedrock pack's SHA-1, when, and the build error if it failed. The " +
                "Bedrock pack is applied: Bedrock players get the hub's. The Java one is in shadow mode: Java players still get the " +
                "editor's pack; the hub's build is compared with it.",
            schema("server" to string("A server id from artisan_overview."), required = listOf("server")),
            readOnly = true, ::packStatus,
        ),
        Tool(
            "resource_pack_rebuild", "Rebuild the resource pack",
            "Rebuilds a server's resource packs in the hub from the modules that server loaded (online or not), waits for the " +
                "build (wait_seconds, default 30) and returns resource_pack_status. A Bedrock pack that changed is sent to the " +
                "server's Bedrock players, so ask the player first. The Java pack is in shadow mode: built and compared, it does " +
                "not reach Java players yet. A build still running at the deadline goes on: call resource_pack_status later.",
            schema(
                "server" to string("A server id from artisan_overview."),
                "wait_seconds" to mapOf("type" to "integer", "minimum" to 0, "maximum" to 120, "description" to "How long to wait for the build (default 30)."),
                required = listOf("server"),
            ),
            readOnly = false, ::packRebuild, requires = EditorPermissions.PUBLISH, destructive = true,
        ),
    )

    fun find(name: String): Tool? = tools.firstOrNull { it.name == name }

    /** The tools [principal] may call: those needing a permission it lacks are not offered. */
    fun available(principal: McpPrincipal): List<Tool> =
        tools.filter { (it.requires == null || principal.can(it.requires)) && (!it.destructive || principal.canDeploy) }

    /**
     * The tools of a principal that never deploys: the editor's assistant. It may create an empty module
     * (`create_module`, the player's own publish permission): nothing in it runs before a deployed draft.
     */
    val draftOnly: List<Tool> get() = tools.filter { !it.destructive }

    /** A tool call's answer as a model reads it: the MCP endpoint and the editor's assistant both hand it on. */
    class Outcome(val body: Any?, val error: Boolean)

    fun invoke(principal: McpPrincipal, tool: Tool, args: JsonNode): Outcome = try {
        if (tool.destructive && !principal.canDeploy) throw McpRefusal("forbidden", McpProjects.NOT_ALLOWED)
        if (tool.requires != null && !principal.can(tool.requires))
            throw McpRefusal("forbidden", if (tool.requires == EditorPermissions.PUBLISH) "The player lacks artisan.editor.publish." else "The player lacks ${tool.requires}.")
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
                // The plugins that extend Artisan on this server (Java add-ons, `addons` so the player's modules, the Projects, keep the word).
                put("addons", announcement?.modules?.mapNotNull { it["id"] } ?: emptyList<Any>())
            }
        }
        return mapOf(
            "player" to principal.playerName,
            "can_write_drafts" to principal.can(EditorPermissions.EDIT),
            "can_deploy" to principal.canDeploy,
            "can_create_modules" to principal.can(EditorPermissions.PUBLISH),
            "servers" to servers,
            "workflow" to listOfNotNull(
                "1. Pick a Project (the player calls it a module). Read what exists with list_documents and read_document. " +
                    "When the player asks for a new module, create_module makes it" +
                    (if (principal.can(EditorPermissions.PUBLISH)) "." else ": this player may not create modules, they do it in the editor (New module)."),
                "2. Before writing a kind you have not written yet, call get_kind_guide for it.",
                "3. start_draft once per piece of work, then write_document for each file; fix what the checks report.",
                if (principal.canDeploy)
                    "4. Show the player the changes (draft_publish with dry_run: true), and deploy with draft_publish only once they say yes. " +
                        "Or tell them the draft's name: they can review and deploy it in the editor (Drafts)."
                else if (!principal.deploys)
                    "4. Tell the player the draft's name: they review and deploy it themselves, in the editor (Drafts, or Review and deploy)."
                else
                    "4. Tell the player the draft's name: they open it in the editor (Drafts), review, and click Deploy. This app may not " +
                        "deploy: the player can allow it in Settings → AI apps.",
                "Visible text goes in the Document as written; references to other Documents use their id, e.g. `open_menu shop`.",
                VARIANTS_HOWTO,
                ORIGINALS_HOWTO,
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
        val manifest = ModuleFile.NAMES.firstNotNullOfOrNull { tree[it] }?.let(ManifestYaml::parse)
        val index = Originals.parseIndex(tree[Originals.INDEX_PATH])
        val exclusions = Originals.exclusions(manifest, index)
        val layout = DocumentLayout.classify(tree.keys, kinds.keys, exclusions.excluded)
        // What the module ships, id for id: an owner's Document over one of them is a modified one.
        val prefix = "${Originals.DIR}/"
        val shipped = DocumentLayout.classify(tree.keys.filter { it.startsWith(prefix) }.map { it.removePrefix(prefix) }, kinds.keys)
            .let { it.documents + it.variants }.mapTo(HashSet()) { Triple(it.variant, it.dir, it.id) }
        fun origin(e: DocumentLayout.Entry) = when {
            e.original -> "original"
            Triple(e.variant, e.dir, e.id) in shipped -> "modified"
            else -> "added"
        }
        val hasOriginals = shipped.isNotEmpty()
        fun entry(e: DocumentLayout.Entry, vararg extra: Pair<String, Any?>) =
            linkedMapOf<String, Any?>("path" to e.path, "kind" to kinds[e.dir], "id" to e.id).apply {
                putAll(extra)
                if (hasOriginals) put("origin", origin(e))
            }
        val documents = layout.documents.map { entry(it) }
        val variantDocs = layout.variants.map { entry(it, "variant" to it.variant) }
        val rulesFile = DocumentLayout.variantsPath(tree.keys)
        val listed = (documents + variantDocs).map { it["path"] }.toSet() + listOfNotNull(rulesFile) +
            tree.keys.filter { it.startsWith(prefix) }
        @Suppress("UNCHECKED_CAST")
        val failed = (read["failed"] as? List<Map<String, Any?>>).orEmpty()
        val drafts = runCatching { projects.draft(principal, project, "list") }.getOrNull()
            ?.let { (it["drafts"] as? List<*>)?.filterIsInstance<Map<*, *>>() }
            ?.map { mapOf("draft_id" to it["id"], "name" to it["name"], "revision" to it["revision"], "source" to it["source"], "updated_at" to it["updatedAt"]) }
        return mapOf(
            "project" to project.id,
            "draft_id" to draftId,
            "documents" to documents,
            "variants" to rulesFile?.let { file ->
                mapOf(
                    "rules_file" to file,
                    "names" to variantDocs.map { it["variant"] }.distinct(),
                    "documents" to variantDocs,
                )
            },
            "originals" to if (!hasOriginals) null else mapOf(
                "module" to index.module, "version" to index.version, "required" to index.required,
                "excluded" to exclusions.excluded, "exclusions_refused" to exclusions.refused,
            ),
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

    private fun readDocs(principal: McpPrincipal, args: JsonNode): Any {
        val path = args.path("page").asText("").ifBlank { return UserDocs.index() }
        val page = UserDocs.page(path) ?: throw McpRefusal("not_found", "No docs page '$path'. read_docs without page lists them.")
        return "# ${page.title}\n\n${page.body.trim()}\n"
    }

    private fun packServer(args: JsonNode): String {
        val serverId = text(args, "server")
        projects.servers().firstOrNull { it.id == serverId }
            ?: throw McpRefusal("unknown_server", "No server '$serverId'. Server ids are in artisan_overview.")
        return serverId
    }

    private fun packStatus(principal: McpPrincipal, args: JsonNode): Any {
        val server = packServer(args)
        return packAnswer(server, packs!!.status(server), done = true)
    }

    private fun packRebuild(principal: McpPrincipal, args: JsonNode): Any {
        val server = packServer(args)
        val wait = args.path("wait_seconds").asInt(30).coerceIn(0, 120)
        val build = packs!!.request(server)
        val status = try {
            build.get(wait.toLong(), java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: java.util.concurrent.TimeoutException) {
            return packAnswer(server, packs.status(server), done = false)
        }
        return packAnswer(server, status, done = true)
    }

    private fun packAnswer(server: String, status: PackBuilder.Status?, done: Boolean): Map<String, Any?> = mapOf(
        "server" to server,
        "mode" to "shadow",
        "done" to done,
        "built" to (status?.builtAt != null),
        "hub_sha1" to status?.hubHash,
        "editor_sha1" to status?.editorHash,
        "matches" to status?.matches,
        "bedrock_sha1" to status?.bedrockHash,
        "built_at" to status?.builtAt?.let { java.time.Instant.ofEpochMilli(it).toString() },
        "error" to status?.error,
        "note" to when {
            !done -> "The build is still running: call resource_pack_status in a moment."
            status == null -> "No pack state for this server: it has not loaded its modules into the suite database yet."
            status.error != null -> "The hub's build failed; players keep the pack they had."
            status.matches == false -> "The hub's pack differs from the editor's: a module may declare pack images in its editor only."
            status.hubHash == null -> "Bedrock players get the hub's pack (bedrock_sha1). The Java pack is built by the Pro edition only."
            else -> "Bedrock players get the hub's pack (bedrock_sha1); Java players get the editor's, compared with the hub's build (shadow mode)."
        },
    )

    private fun createModule(principal: McpPrincipal, args: JsonNode): Any {
        val serverId = text(args, "server")
        val server = projects.servers().firstOrNull { it.id == serverId }
            ?: throw McpRefusal("unknown_server", "No server '$serverId'. Server ids are in artisan_overview.")
        val name = text(args, "name").trim()
        if (!MODULE_NAME.matches(name))
            throw McpRefusal("invalid_name", "A module's folder name is letters, digits, `_` and `-`, starting with a letter or a digit (at most 128).")
        val created = projects.create(principal, server, name)
        return mapOf(
            "project" to created.id, "created" to true,
            "next" to "start_draft on ${created.id}, then write_document for each file; the player deploys the draft.",
        )
    }

    private fun startDraft(principal: McpPrincipal, args: JsonNode): Any {
        requireEdit(principal)
        val project = projects.project(text(args, "project"))
        val name = text(args, "name").trim().take(120)
        val read = projects.read(project)
        val tree = files(read)
        val binaries = binaries(read["binaries"])
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
        if (Originals.isOriginal(path)) throw McpRefusal("originals_read_only", ORIGINALS_HOWTO)
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

    private fun listVersions(principal: McpPrincipal, args: JsonNode): Any {
        val project = projects.project(text(args, "project"))
        val limit = args.path("limit").asInt(10).coerceIn(1, 50)
        val versions = versions(project)
        return mapOf(
            "project" to project.id,
            "versions" to versions.take(limit).map { v ->
                val changed = (v["changed"] as? List<*>).orEmpty()
                mapOf(
                    "version" to v["id"], "created_at" to v["createdAt"], "published_by" to byline(v["author"]),
                    "restored_from" to v["restoredFrom"], "changed" to changed.take(20), "changed_count" to changed.size,
                )
            },
            "total" to versions.size,
        )
    }

    private fun draftPublish(principal: McpPrincipal, args: JsonNode): Any {
        val project = projects.project(text(args, "project"))
        val draftId = text(args, "draft_id")
        val expected = args.path("expected_revision").takeIf { it.isIntegralNumber }?.asLong()
            ?: throw McpRefusal("invalid_input", "expected_revision is required: the draft revision the player reviewed.")
        val draft = draftSnapshot(principal, project, draftId)
        if (draft.revision != expected) {
            throw McpRefusal("draft_conflict", "The draft is at revision ${draft.revision}, not $expected: it changed since. Show the player the changes again (dry_run).")
        }
        val changes = changes(draft.json)
        if (changes.isEmpty()) throw McpRefusal("nothing_to_deploy", "Draft $draftId changes nothing on the server.")
        if (args.path("dry_run").asBoolean(false)) {
            val problems = projects.check(project, draft.tree.filter { (p, text) -> draft.baseline[p] != text }, draft.baseline.keys - draft.tree.keys)
            return mapOf(
                "deployed" to false, "dry_run" to true, "project" to project.id, "draft_id" to draftId, "revision" to draft.revision,
                "changes" to changes, "problems" to problems.ifEmpty { null },
                "next" to if (problems.isEmpty()) "Show the player these changes; with their yes, call draft_publish without dry_run."
                else "The server would refuse this deploy: fix the problems with write_document first.",
            )
        }
        return deploy(principal, project, draftId, draft.revision, changes)
    }

    private fun versionRollback(principal: McpPrincipal, args: JsonNode): Any {
        val project = projects.project(text(args, "project"))
        val target = text(args, "version")
        val expected = text(args, "expected_version")
        val latest = versions(project).firstOrNull()?.get("id")?.toString()
        if (latest != expected) throw McpRefusal("version_conflict", "The newest Version is $latest, not $expected: another deploy came since. List the versions again.")
        if (target == latest) throw McpRefusal("nothing_to_deploy", "Version $target is the one the server runs.")
        val version = projects.version(project, target) ?: throw McpRefusal("not_found", "No Version $target of ${project.id}: list_versions lists them.")
        val read = projects.read(project)
        val current = files(read)
        val currentBinaries = binaries(read["binaries"])
        val files = (version["files"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()
            .mapNotNull { f -> (f["path"] as? String)?.takeIf(::contentPath)?.let { it to (f["content"] as? String).orEmpty() } }.toMap()
        val binaries = binaries(version["binaries"])
        val snapshot = mapOf(
            "baseline" to current, "tree" to files, "initialTree" to current,
            "binaryBaseline" to currentBinaries, "binaryTree" to binaries,
            "at" to System.currentTimeMillis(), "restoredFrom" to target,
        )
        val draftId = UUID.randomUUID().toString()
        refuseDraft(projects.draft(
            principal, project, "create",
            "draft_id" to draftId, "operation_id" to UUID.randomUUID().toString(), "name" to "Rollback to Version $target",
            "snapshot" to snapshot, "source" to SOURCE,
        ))
        // Images and fonts the server no longer has: their bytes from the Version, into the draft.
        val known = currentBinaries.values.mapNotNull { it["hash"] }.toSet()
        binaries.filter { (_, ref) -> ref["hash"] !in known }.forEach { (path, ref) ->
            val bytes = projects.versionBinary(project, target, path)
                ?: throw McpRefusal("missing_blob", "Version $target's file $path is no longer stored: it cannot be rolled back.")
            refuseDraft(projects.draft(
                principal, project, "write_blob",
                "draft_id" to draftId, "expected_revision" to 1, "operation_id" to UUID.randomUUID().toString(),
                "hash" to ref["hash"], "content_base64" to java.util.Base64.getEncoder().encodeToString(bytes),
            ))
        }
        val changes = changes(Call.mapper.valueToTree(snapshot))
        return when (val out = deploy(principal, project, draftId, 1, changes)) {
            is Map<*, *> -> out + ("restored_from" to target)
            else -> out
        }
    }

    /** Publishes [draftId] at [revision]: the server's checks, its compare-and-swap, then the Version it recorded. */
    private fun deploy(principal: McpPrincipal, project: ProjectRef, draftId: String, revision: Long, changes: List<Map<String, Any?>>): Any {
        val before = runCatching { versions(project).firstOrNull()?.get("id")?.toString() }.getOrNull()
        val reply = projects.draft(
            principal, project, "publish",
            "draft_id" to draftId, "expected_revision" to revision, "operation_id" to UUID.randomUUID().toString(),
        )
        if (reply["ok"] != true) {
            when (reply["error"]) {
                "invalid_documents" -> return Refused(mapOf(
                    "deployed" to false, "error" to "invalid_documents", "draft_id" to draftId, "problems" to reply["problems"],
                    "hint" to "The server refused the deploy: nothing changed. Fix these files with write_document, then deploy again.",
                ))
                "conflict" -> throw McpRefusal(
                    "conflict",
                    "The server's files changed since the draft started (another deploy): nothing was deployed. " +
                        "Conflicting files: ${(reply["conflicts"] as? List<*>).orEmpty().mapNotNull { (it as? Map<*, *>)?.get("path") }.joinToString()}. Start a new draft.",
                )
            }
            refuseDraft(reply)
        }
        val version = recorded(project, before)
        return mapOf(
            "deployed" to true, "project" to project.id, "draft_id" to draftId, "wrote" to reply["wrote"],
            "version" to version, "previous_version" to before,
            "published_by" to principal.clientName?.let { "${principal.playerName} via $it" },
            "changes" to changes,
            "undo" to before?.let { "version_rollback with version $it and expected_version ${version ?: "(the new one, from list_versions)"}" },
            "note" to if (version == null) "The server is still loading the deploy: its Version will show in list_versions shortly." else null,
        )
    }

    /** The Version the server records once it loaded a deploy: a moment after it answers. Null when none came in time. */
    private fun recorded(project: ProjectRef, before: String?): String? {
        val until = System.nanoTime() + VERSION_WAIT_MS * 1_000_000
        while (true) {
            val latest = runCatching { projects.versions(project)?.firstOrNull()?.get("id")?.toString() }.getOrNull()
            if (latest != null && latest != before) return latest
            if (System.nanoTime() > until || projects.versions(project) == null) return null
            Thread.sleep(200)
        }
    }

    /** What a draft changes against what the server runs: each text file's diff, each binary's path. */
    private fun changes(snapshot: JsonNode): List<Map<String, Any?>> {
        fun texts(key: String) = snapshot.path(key).fields().asSequence().filter { it.value.isTextual }.associate { it.key to it.value.asText() }
        fun hashes(key: String) = snapshot.path(key).fields().asSequence().associate { it.key to it.value.path("hash").asText() }
        val before = texts("baseline")
        val after = texts("tree")
        var budget = MAX_DIFF
        val text = (before.keys + after.keys).sorted().filter { before[it] != after[it] }.map { path ->
            val change = when { before[path] == null -> "added"; after[path] == null -> "deleted"; else -> "modified" }
            val diff = if (budget > 0) TextDiff.unified(before[path], after[path]).take(budget) else null
            budget -= diff?.length ?: 0
            mapOf("path" to path, "change" to change, "diff" to (diff ?: "(diff left out: the answer is long enough)"))
        }
        val binaryBefore = hashes("binaryBaseline")
        val binaryAfter = hashes("binaryTree")
        val binary = (binaryBefore.keys + binaryAfter.keys).sorted().filter { binaryBefore[it] != binaryAfter[it] }.map { path ->
            mapOf("path" to path, "change" to when { binaryBefore[path] == null -> "added"; binaryAfter[path] == null -> "deleted"; else -> "modified" }, "binary" to true)
        }
        return text + binary
    }

    private fun versions(project: ProjectRef): List<Map<String, Any?>> =
        projects.versions(project) ?: throw McpRefusal("database_unavailable", "Versions need the suite database, which this server does not have open.")

    private fun byline(author: Any?): String? {
        val a = author as? Map<*, *> ?: return null
        val name = a["name"]?.toString().orEmpty().ifEmpty { a["id"]?.toString() }
        return a["via"]?.toString()?.takeIf { it.isNotBlank() }?.let { "$name via $it" } ?: name
    }

    @Suppress("UNCHECKED_CAST")
    private fun binaries(list: Any?): Map<String, Map<String, Any?>> = (list as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()
        .filter { contentPath(it["path"].toString()) }
        .associate { it["path"].toString() to mapOf("hash" to it["hash"], "size" to it["size"]) }

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
        /** How a module's variants are written, through the same file tools (design `variantes-modules`). */
        const val VARIANTS_HOWTO =
            "Variants: a module may show other versions of its menus and dialogs to some players (Bedrock, resource pack " +
                "loaded, a permission, any condition). They are files too. `variants.yml` at the module root lists the display " +
                "rules in order (`schema: variants/v1`, `rules: [{variant: textured, when: {has_pack: true}}, {variant: bedrock, " +
                "when: {client: bedrock}}, {variant: dev, enabled: false, when: {permission: op}}]`; `when` takes client " +
                "(bedrock|java), has_pack, permission and condition, all required together). A variant's version of " +
                "`menus/ranks.yml` is `variants/<name>/menus/ranks.yml`: same id, same `inputs`, a whole Document. A variant's " +
                "command file (`variants/<name>/commands/<id>.yml`) holds only `actions`, `requirements`, `fallback`, on the root " +
                "and on `subcommands` found by `name`. For each player and each file, the first enabled rule that holds and whose " +
                "variant has the file wins, else the module's own file. list_documents shows the variants apart."

        /** How a module's originals work, through the same file tools (design `originaux-modules`). */
        const val ORIGINALS_HOWTO =
            "Originals: `originals/` in a module holds what the module ships (its menus, dialogs, commands, variants), " +
                "written by the server only and updated with the module; it cannot be written. The module's own files hold only " +
                "what the owner changed or added, and a Document there wins over the original of the same kind and id (same " +
                "variant). To change an original, write it without the `originals/` prefix (read it first: start from its " +
                "content). To go back to the original, delete that file. To drop an original, add its path relative to " +
                "`originals/` to `originals: {exclude: [...]}` in artisan-module.yml; `originals/originals.yml` lists the " +
                "required ones, which cannot be dropped. list_documents gives each Document's origin: original, modified or added."

        /** A result as the model reads it: prose as it is, anything else as JSON, indented for an MCP client's reader. */
        fun resultText(body: Any?, indent: Boolean = true): String = body as? String
            ?: (if (indent) Call.mapper.writerWithDefaultPrettyPrinter() else Call.mapper.writer()).writeValueAsString(body)

        /** What a draft made through the MCP endpoint says it came from: the editor shows it. */
        private const val SOURCE = "ai"
        private const val MAX_FILE = 512 * 1024
        private const val MAX_EXAMPLE = 8000
        /** Characters of diff a deploy's answer carries, all files together. */
        private const val MAX_DIFF = 30_000
        /** How long a deploy's answer waits for the server to record its Version. */
        private const val VERSION_WAIT_MS = 5_000L

        private val PROJECT = string("A Project id, `<server id>.<folder>`, from artisan_overview.")
        /** A Project folder name, as the server's `ProjectFolders` and the editor accept it. */
        private val MODULE_NAME = Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
        private val PROJECT_OPTIONAL = string("Optional: a Project id, for an example from it.")
        private val DRAFT_OPTIONAL = string("Optional: a draft id from start_draft, to read the draft instead of what is deployed.")
        private val PATH = string("A path in the Project, e.g. `menus/shop.yml` or `lang/en.yml`.")

        private fun string(description: String) = mapOf("type" to "string", "description" to description)

        private fun schema(vararg properties: Pair<String, Map<String, Any?>>, required: List<String> = properties.map { it.first }.filter { it == "project" }): Map<String, Any?> =
            mapOf("type" to "object", "properties" to properties.toMap(), "required" to required, "additionalProperties" to false)
    }
}
