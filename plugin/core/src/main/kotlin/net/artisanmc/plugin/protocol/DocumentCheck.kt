package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.networknt.schema.JsonSchema
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaValidatorsConfig
import com.networknt.schema.SpecVersion
import com.networknt.schema.resource.InputStreamSource
import net.artisanmc.modules.api.document.DocumentChangeCheck
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.model.DocumentLayout
import net.artisanmc.plugin.project.ProjectPathPolicy
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import java.nio.file.Files
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * Would this server load these files? The check a Document goes through before an AI client may
 * put it in a draft (ADR `mcp-server`), in five stages, each reported under its name:
 *
 * 1. `layout`: the path is a Document's place (`<folders…>/<kind dir>/<id>.yml`);
 * 2. `yaml`: the file parses;
 * 3. `schema`: it matches the JSON schema of its `schema:` label, when the jar ships one
 *    (`docs/schema`, under `schema/<label>.json`);
 * 4. `actions`: each module action it names is one this server declares, with declared arguments
 *    ([ActionCheck]), when the server declares any;
 * 5. `engine`: the server's own reader loads it, on a copy of the Project with the files applied;
 * 6. `module`: the module that owns its kind would load it (`DocumentChangeCheck`, API 1.9.0),
 *    asked only for a file the stages above let through, and for a deleted one.
 *
 * The module also says what the change does to the players already in the game ([Impact]): never
 * a refusal, shown by the editor's review above the file's diff.
 *
 * The engine's reader skips what it does not know; the schema does not. A typo in a field name
 * passes stage 4 and fails stage 3, which is why both run.
 */
class DocumentCheck(
    /** The kinds whose module checks a changed file, by folder. */
    private val changeChecks: () -> Map<String, DocumentChangeCheck> = { DocumentKinds.changeChecks() },
    /** The server's `declared_actions` ([ServerAnnouncement.actions]); empty: the `actions` stage is skipped. */
    private val actions: () -> List<Map<String, Any?>> = { emptyList() },
) {
    data class Problem(val path: String, val stage: String, val message: String)

    /**
     * What deploying [path] does in the game, said by its kind's module. [level]: `loss` (players
     * lose something: the author confirms), `notice`, or `unassessed` (the module's check threw;
     * [message] is then the exception, for the log).
     */
    data class Impact(val path: String, val level: String, val message: String)

    data class Result(val problems: List<Problem>, val impacts: List<Impact>)

    private val yaml = ObjectMapper(YAMLFactory())
    private val schemas = ConcurrentHashMap<String, JsonSchema?>()
    private val factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012) { builder ->
        // The schemas cross-reference each other by their `$id`: read from the jar, never fetched.
        builder.schemaLoaders { loaders ->
            loaders.add { iri ->
                val address = iri.toString()
                if (!address.startsWith(SCHEMA_BASE)) null
                else resource(address.removePrefix(SCHEMA_BASE))?.let { bytes -> InputStreamSource { bytes.inputStream() } }
            }
        }
    }
    private val config = SchemaValidatorsConfig.builder().locale(Locale.ENGLISH).build()

    /**
     * The problems of [paths] once [files] (path → text) replace the same paths of [tree], the
     * Project's text files as the server loaded them, and [deletes] are removed. Empty: every
     * file of [paths] loads.
     */
    fun check(
        projectId: String,
        tree: Map<String, String>,
        files: Map<String, String>,
        deletes: Collection<String> = emptyList(),
        paths: Collection<String> = files.keys,
    ): List<Problem> = inspect(projectId, tree, files, deletes, paths).problems

    /** [check], plus what the modules say the change does in the game, in [lang]. */
    fun inspect(
        projectId: String,
        tree: Map<String, String>,
        files: Map<String, String>,
        deletes: Collection<String> = emptyList(),
        paths: Collection<String> = files.keys,
        lang: String = "en",
    ): Result {
        val project = tree - deletes.toSet() + files
        val problems = mutableListOf<Problem>()
        val actionCheck = ActionCheck(actions())
        val layout = DocumentLayout.classify(project.keys, DocumentKinds.all().map { it.dir }.toSet())
        // A variant's menu or dialog is a whole Document, checked like the module's; its command
        // holds only steps (`CommandVariant`): the engine load checks it.
        val variable = setOf(DocumentKinds.MENU.dir, DocumentKinds.DIALOG.dir)
        val documents = (layout.documents + layout.variants.filter { it.dir in variable }).associateBy { it.path }
        for (path in paths) {
            if (!ProjectPathPolicy.valid(path)) {
                problems += Problem(path, "layout", "this path cannot be written in a Project")
                continue
            }
            if (net.artisanmc.plugin.model.Originals.isOriginal(path)) {
                problems += Problem(path, "layout", "originals/ holds what the module ships: the server writes it; write the same path without originals/ instead")
                continue
            }
            layout.errors.firstOrNull { it.path == path }?.let { problems += Problem(path, "layout", it.reason) }
            val entry = documents[path] ?: continue
            val text = project[path] ?: continue
            val node = try {
                yaml.readTree(text)
            } catch (e: Exception) {
                problems += Problem(path, "yaml", firstLine(e.message))
                continue
            }
            if (node == null || !node.isObject) {
                problems += Problem(path, "yaml", "a Document is a YAML mapping")
                continue
            }
            val kind = DocumentKinds.byDir(entry.dir) ?: continue
            val label = node.path("schema").asText("").ifEmpty { kind.canonicalSchema }
            if (label !in kind.schemaVersions) {
                problems += Problem(path, "schema", "schema '$label' is not one of ${kind.schemaVersions.joinToString()}")
                continue
            }
            problems += schemaProblems(path, label, node)
            problems += actionCheck.problems(node).map { Problem(path, "actions", it) }
        }
        if (problems.none { it.stage == "yaml" || it.stage == "layout" }) problems += engineProblems(projectId, project, paths.toSet())
        val impacts = mutableListOf<Impact>()
        moduleStage(projectId, tree, project, paths + deletes, lang, problems, impacts)
        return Result(problems, impacts)
    }

    /** Stage `module`: each changed or deleted file of a kind whose module checks it, unless a stage above refused it. */
    private fun moduleStage(
        projectId: String,
        tree: Map<String, String>,
        project: Map<String, String>,
        paths: Collection<String>,
        lang: String,
        problems: MutableList<Problem>,
        impacts: MutableList<Impact>,
    ) {
        val checks = changeChecks()
        if (checks.isEmpty()) return
        val refused = problems.mapTo(HashSet()) { it.path }
        val parsed = HashMap<String, Map<String, Any?>?>()
        fun document(text: String?, id: String): Map<String, Any?>? {
            val value = text?.let { runCatching { yaml.readValue(it, Any::class.java) }.getOrNull() } as? Map<*, *> ?: return null
            return LinkedHashMap<String, Any?>().apply {
                for ((key, item) in value) put(key.toString(), item)
                put("id", id)
            }
        }
        for (path in paths.toSortedSet()) {
            if (path in refused) continue
            val match = KIND_FILE.matchEntire(path) ?: continue
            val (dir, id) = match.destructured
            val moduleCheck = checks[dir] ?: continue
            val before = document(tree[path], id)
            val after = document(project[path], id)
            if (before == null && after == null) continue
            val others = LinkedHashMap<String, Map<String, Any?>>()
            for (other in project.keys.sorted()) {
                if (other == path) continue
                val sibling = KIND_FILE.matchEntire(other)?.takeIf { it.groupValues[1] == dir } ?: continue
                parsed.getOrPut(other) { document(project[other], sibling.groupValues[2]) }?.let { others[sibling.groupValues[2]] = it }
            }
            val findings = try {
                moduleCheck.check(DocumentChangeCheck.Change(projectId, id, before, after, others, lang)).orEmpty()
            } catch (e: Throwable) {
                impacts += Impact(path, "unassessed", "${e.javaClass.simpleName}: ${firstLine(e.message)}")
                continue
            }
            for (finding in findings.take(MAX_MODULE_FINDINGS)) {
                val message = finding?.message()?.trim()?.take(600)?.ifEmpty { null } ?: continue
                when (finding.level()) {
                    DocumentChangeCheck.Level.PROBLEM -> problems += Problem(path, "module", message)
                    DocumentChangeCheck.Level.LOSS -> impacts += Impact(path, "loss", message)
                    else -> impacts += Impact(path, "notice", message)
                }
            }
        }
    }

    /** The schema of [label] (`menu/v1`), null when the jar ships none: a module's kind, for now. */
    private fun schema(label: String): JsonSchema? = schemas.computeIfAbsent(label) {
        if (resource("$label.json") == null) null
        else factory.getSchema(SchemaLocation.of("$SCHEMA_BASE$label.json"), config)
    }

    private fun schemaProblems(path: String, label: String, node: JsonNode): List<Problem> {
        val schema = schema(label) ?: return emptyList()
        // `oneOf` reports every branch: the shortest locations first, they name the field to fix.
        return schema.validate(node)
            .sortedWith(compareBy({ it.instanceLocation.nameCount }, { it.message }))
            .take(MAX_SCHEMA_PROBLEMS)
            // At the root the location is empty and the message starts with ": ".
            .map { Problem(path, "schema", it.message.removePrefix(": ")) }
    }

    /** The engine's own read, on a temporary copy: what it skips among [paths], with its reason. */
    private fun engineProblems(projectId: String, project: Map<String, String>, paths: Set<String>): List<Problem> {
        val root = Files.createTempDirectory("artisan-check-").toFile()
        try {
            val dir = File(root, projectId)
            for ((path, text) in project) {
                if (!ProjectPathPolicy.valid(path)) continue
                File(dir, path).apply { parentFile.mkdirs() }.writeText(text)
            }
            val skipped = mutableListOf<Problem>()
            try {
                ProjectReader(ProjectRoots(root), onSkip = { _, path, reason -> if (path in paths) skipped += Problem(path, "engine", reason) }).readAll()
            } catch (e: Exception) {
                // An unsupported `schema:` fails the whole read: it names its file.
                val path = paths.firstOrNull { e.message?.contains(File(dir, it).path) == true } ?: paths.firstOrNull().orEmpty()
                skipped += Problem(path, "engine", firstLine(e.message))
            }
            return skipped
        } finally {
            root.deleteRecursively()
        }
    }

    private fun firstLine(message: String?) = message?.lineSequence()?.firstOrNull()?.take(300) ?: "unreadable"

    private fun resource(name: String): ByteArray? =
        DocumentCheck::class.java.getResourceAsStream("/schema/$name")?.use { it.readBytes() }

    companion object {
        /** What the `$id` of every schema of `docs/schema` starts with. */
        const val SCHEMA_BASE = "https://docs.artisanmc.net/schema/"
        const val MAX_SCHEMA_PROBLEMS = 15
        const val MAX_MODULE_FINDINGS = 40
        /** A Document's place: `<kind dir>/<id>.yml`, the only one a module's kind has. */
        private val KIND_FILE = Regex("^([^/]+)/([^/]+)\\.ya?ml$")
    }
}
