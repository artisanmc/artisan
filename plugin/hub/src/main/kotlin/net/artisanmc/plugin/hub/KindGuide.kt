package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import net.artisanmc.plugin.model.ManifestYaml
import net.artisanmc.plugin.model.ModuleFile

/**
 * What `get_kind_guide` says about a Document kind, as text for a model: where the file goes, an
 * outline of its schema ([SchemaOutline]), the actions this server's modules declare (the schema
 * only knows the core's), how a text is translated in this Project, and an example.
 */
class KindGuide(
    private val name: String,
    private val kind: Map<String, Any?>,
    private val schema: JsonNode?,
    /** The server's `declared_actions` (`{name, args, primary?, module_id?}`). */
    private val declaredActions: List<Map<String, Any?>>,
    /** The Project's files, when one was named: its languages and an example come from it. */
    private val files: Map<String, String>?,
    private val example: Pair<String, String>?,
) {
    fun render(full: Boolean): String = buildString {
        val dir = kind["dir"] as String
        val label = (kind["schema_versions"] as? List<*>)?.firstOrNull()?.toString().orEmpty()
        append("# ").append(name).append(" Documents\n\n")
        append("File: ").append(dir).append("/<id>.yml (or <folders>/").append(dir).append("/<id>.yml); the file name is the Document's id.\n")
        append("First line: `schema: ").append(label).append("`\n")
        (kind["id_prefix"] as? String)?.let { append("Ids start with `").append(it).append("`.\n") }
        when {
            schema == null -> append("\nThis kind comes from a module: no schema ships with Artisan. The server's engine still checks each file; ")
                .append("follow the example and fix what write_document reports.\n")
            full -> append("\n## JSON schema\n```json\n").append(Call.mapper.writeValueAsString(schema)).append("\n```\n")
            else -> append('\n').append(SchemaOutline(schema).render())
                .append("\nThe outline leaves out legacy forms, which are still read but never written. ")
                .append("get_kind_guide with detail: \"schema\" returns the full JSON schema.\n")
        }
        moduleActions()?.let(::append)
        if (schema == null || schema.path("\$defs").has("LText")) append(languages())
        example?.let { (path, content) -> append("\n## Example: ").append(path).append("\n```yaml\n").append(content.trimEnd()).append("\n```\n") }
    }

    /** The actions the server declares beyond the schema's: modules' (`guilds:rank_delete`), and Artisan's own extras. */
    private fun moduleActions(): String? {
        val core = schema?.path("\$defs")?.path("Action")?.path("oneOf")
            ?.flatMap { it.path("properties").fieldNames().asSequence().toList() }?.toSet().orEmpty()
        val extra = declaredActions.filter { it["name"] is String && it["name"] !in core }.sortedBy { it["name"] as String }
        if (extra.isEmpty()) return null
        return buildString {
            append("\n## Actions declared on this server\n")
            append("Written like the others, as a step: `- name` without arguments, `- name: value` for the one marked primary, ")
                .append("`- name: {arg: value, …}` otherwise.\n")
            for (action in extra) {
                @Suppress("UNCHECKED_CAST")
                val args = (action["args"] as? List<Map<String, Any?>>).orEmpty()
                append("- ").append(action["name"])
                (action["module_id"] as? String)?.let { append(" (module ").append(it).append(')') }
                append(": ")
                append(if (args.isEmpty()) "no arguments" else args.joinToString(", ", "{", "}") { arg(it) })
                (action["primary"] as? String)?.let { append("; primary: ").append(it) }
                append('\n')
                for (a in args) (a["help"] as? String)?.takeIf { it.isNotBlank() }?.let { append("  - ").append(a["name"]).append(": ").append(it).append('\n') }
            }
        }
    }

    private fun arg(field: Map<String, Any?>): String {
        val optional = if (field["required"] == true) "" else "?"
        val default = field["default"]?.let { " = $it" }.orEmpty()
        @Suppress("UNCHECKED_CAST")
        return "${field["name"]}$optional: ${type(field["type"] as? Map<String, Any?>)}$default"
    }

    /** A `model/v1` field type, short. */
    @Suppress("UNCHECKED_CAST")
    private fun type(type: Map<String, Any?>?): String {
        if (type == null) return "any"
        val of = type["of"] as? Map<String, Any?>
        return when (val kind = type["kind"]) {
            "ltext" -> "text"
            "minimessage", "minimessage_multiline" -> "MiniMessage text"
            "item" -> "item (material or item:<id>)"
            "actions" -> "action steps"
            "conditions" -> "conditions"
            "list" -> "list of ${type(of)}"
            "map" -> "map of ${type(of)}"
            "enum" -> (type["values"] as? List<*>).orEmpty().joinToString(" | ")
            "object" -> (type["fields"] as? List<Map<String, Any?>>).orEmpty().joinToString(", ", "{", "}") { arg(it) }
            "model" -> "${type["ref"]} row"
            "union" -> "one of its variants, chosen by `${type["tag"]}`"
            "document_ref" -> "id of a ${type["document"]} Document"
            else -> kind.toString()
        }
    }

    /** How a text is written in each language, with this Project's languages when it was named. */
    private fun languages(): String = buildString {
        append("\n## Texts and languages\n")
        val manifest = files?.let { tree -> ModuleFile.NAMES.firstNotNullOfOrNull { tree[it] }?.let(ManifestYaml::parse) }
        val langFiles = files?.keys.orEmpty().filter { it.startsWith("lang/") && it.endsWith(".yml") }.map { it.removePrefix("lang/").removeSuffix(".yml") }
        if (manifest != null) {
            val others = (manifest.languages + langFiles).distinct() - manifest.defaultLang
            append("This Project's default language is `").append(manifest.defaultLang).append('`')
            append(if (others.isEmpty()) "; it has no other language.\n" else ", with ${others.joinToString(", ") { "`$it`" }}.\n")
        }
        append("A text (a title, a lore line, a message) is written one of three ways:\n")
        append("- a plain string: the same text in every language, read as the default language's;\n")
        append("- a map by language, `title: { fr: Boutique, en: Shop }`: each player reads their language, else the default one, else any entry;\n")
        append("- `\"{i18n:<key>}\"`: a key of the Project's `lang/<code>.yml` files, one file per language.\n")
        append("A translated lore is a list of lines per language, each with its own number of lines:\n")
        append("```yaml\nlore:\n  fr: [Cliquez pour acheter, \"<gold>10 pièces\"]\n  en: [Click to buy]\n```\n")
        append("Without translations, a lore is a plain list of lines. A field is a string or a map, never both. ")
        append("In a Project with several languages, write each new text in all of them, as its other Documents do.\n")
    }
}
