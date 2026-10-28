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
 * 5. `engine`: the server's own reader loads it, on a copy of the Project with the files applied.
 *
 * The engine's reader skips what it does not know; the schema does not. A typo in a field name
 * passes stage 4 and fails stage 3, which is why both run.
 */
class DocumentCheck(
    /** The server's `declared_actions` ([ServerAnnouncement.actions]); empty: the `actions` stage is skipped. */
    private val actions: () -> List<Map<String, Any?>> = { emptyList() },
) {
    data class Problem(val path: String, val stage: String, val message: String)

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
    ): List<Problem> {
        val project = tree - deletes.toSet() + files
        val problems = mutableListOf<Problem>()
        val actionCheck = ActionCheck(actions())
        val layout = DocumentLayout.classify(project.keys, DocumentKinds.all().map { it.dir }.toSet())
        val documents = layout.documents.associateBy { it.path }
        for (path in paths) {
            if (!ProjectPathPolicy.valid(path)) {
                problems += Problem(path, "layout", "this path cannot be written in a Project")
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
        return problems
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
    }
}
