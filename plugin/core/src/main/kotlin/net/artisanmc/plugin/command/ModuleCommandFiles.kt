package net.artisanmc.plugin.command

import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.template.TemplateDeclaration

/**
 * The `command/v1` file of each command a module declares (design `commandes-unifiees` §2): its
 * name, aliases, permission, description and arguments, and actions that call the module's code
 * (`module_command`) or open its menu (`open_menu`). They are the module's system elements of
 * the template [TEMPLATE_ID], kept in its folder by `SystemFiles`: rewritten while untouched,
 * the admin's once edited.
 *
 * Written in the editor's own form (key order, `required` always, a list per `actions`), byte
 * for byte: a Deploy rewrites every file the editor reads, and a file it would rewrite
 * differently would count as edited and stop following the module. The shared vector
 * `testdata/module-command-files.json` holds both sides to it.
 */
object ModuleCommandFiles {
    /** The template holding the generated files, reserved among a module's templates. */
    const val TEMPLATE_ID = "player_commands"

    /** `commands/<name>.yaml`: the document id is the command's name. */
    fun path(declaration: PlayerCommandDeclaration): String = "commands/${declaration.name}.yaml"

    /** The template of [declarations] (a module's root commands), or null when it declares none. */
    fun template(declarations: List<PlayerCommandDeclaration>): TemplateDeclaration? {
        if (declarations.isEmpty()) return null
        val builder = TemplateDeclaration.builder(TEMPLATE_ID, 1).title("Commands").system()
        // A second root of the same name would be the same file: the first keeps it.
        declarations.distinctBy { it.name }.forEach { builder.file(path(it), yaml(it).toByteArray(Charsets.UTF_8)) }
        return builder.build()
    }

    fun yaml(declaration: PlayerCommandDeclaration): String = EditorYaml.write(document(declaration))

    /** The root document, without `id` (the file name) nor `name` (equal to it). */
    fun document(declaration: PlayerCommandDeclaration): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>("schema" to "command/v1")
        // A command without code nor menu only lists its sub-commands: the editor still writes `actions: []`.
        out["actions"] = actions(declaration)
        out.putAll(fields(declaration))
        return out
    }

    private fun subcommand(declaration: PlayerCommandDeclaration): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>("name" to declaration.name)
        actions(declaration).takeIf { it.isNotEmpty() }?.let { out["actions"] = it }
        out.putAll(fields(declaration))
        return out
    }

    private fun actions(declaration: PlayerCommandDeclaration): List<Map<String, Any?>> = when {
        declaration.executor != null -> listOf(mapOf("module_command" to declaration.id))
        declaration.opensMenu != null -> listOf(mapOf("open_menu" to declaration.opensMenu))
        else -> emptyList()
    }

    /** What a command and a sub-command write alike, in the editor's order; `console` last, as a key it keeps as read. */
    private fun fields(declaration: PlayerCommandDeclaration): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>()
        if (declaration.aliases.isNotEmpty()) out["aliases"] = declaration.aliases
        declaration.permission?.let { out["permission"] = it }
        description(declaration.description)?.let { out["description"] = it }
        if (declaration.arguments.isNotEmpty()) out["arguments"] = declaration.arguments.map(::argument)
        if (declaration.children.isNotEmpty()) out["subcommands"] = declaration.children.map(::subcommand)
        if (declaration.isConsoleAllowed) out["console"] = true
        return out
    }

    /**
     * One language: a bare string, which the editor reads as its default language's text and
     * writes back as is. More: `{lang: text}` by language.
     */
    private fun description(byLang: Map<String, String>): Any? {
        val texts = byLang.filterValues { it.isNotEmpty() }.toSortedMap()
        return when (texts.size) {
            0 -> null
            1 -> texts.values.single()
            else -> texts
        }
    }

    /** The editor writes the keys it does not model (`values`) first, then name, type, required. */
    private fun argument(arg: CommandArgument): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>()
        if (arg.type == CommandArgument.Type.ENUM) out["values"] = arg.values
        out["name"] = arg.name
        out["type"] = when (arg.type) {
            // The rest of the line is read as one word, as module commands always were.
            CommandArgument.Type.STRING, CommandArgument.Type.TEXT -> "string"
            CommandArgument.Type.INT -> "integer"
            CommandArgument.Type.PLAYER -> "player"
            CommandArgument.Type.WORLD -> "world"
            CommandArgument.Type.ENUM -> "enum"
        }
        out["required"] = arg.isRequired
        return out
    }
}

/**
 * YAML as the editor's writer prints it (`yaml` with `lineWidth: 0`), for the shapes a
 * generated command holds: maps, lists, strings and booleans. Block maps and lists, a list
 * item's map starting on its dash, `[]` for an empty list; a string plain unless the YAML core
 * schema would read it as something else or a plain scalar cannot hold it, then double-quoted.
 */
object EditorYaml {
    fun write(root: Map<String, Any?>): String = StringBuilder().also { map(it, root, 0) }.toString()

    private fun map(out: StringBuilder, map: Map<String, Any?>, indent: Int, firstInline: Boolean = false) {
        var first = firstInline
        for ((key, value) in map) {
            if (value == null) continue
            if (!first) out.append(" ".repeat(indent))
            first = false
            out.append(key).append(':')
            entry(out, value, indent)
        }
    }

    /** After `key:` or `-`: a scalar on the line, a block below it. */
    private fun entry(out: StringBuilder, value: Any, indent: Int) {
        when {
            value is Map<*, *> && value.isNotEmpty() -> {
                out.append('\n')
                @Suppress("UNCHECKED_CAST")
                map(out, value as Map<String, Any?>, indent + 2)
            }
            value is List<*> && value.isNotEmpty() -> {
                out.append('\n')
                list(out, value, indent + 2)
            }
            value is List<*> -> out.append(" []\n")
            value is Map<*, *> -> out.append(" {}\n")
            else -> out.append(' ').append(scalar(value)).append('\n')
        }
    }

    private fun list(out: StringBuilder, list: List<*>, indent: Int) {
        for (item in list) {
            out.append(" ".repeat(indent)).append('-')
            when {
                item is Map<*, *> && item.isNotEmpty() -> {
                    out.append(' ')
                    @Suppress("UNCHECKED_CAST")
                    map(out, item as Map<String, Any?>, indent + 2, firstInline = true)
                }
                item is List<*> && item.isNotEmpty() -> {
                    out.append('\n')
                    list(out, item, indent + 2)
                }
                else -> entry(out, item ?: "", indent)
            }
        }
    }

    fun scalar(value: Any): String = when (value) {
        is Boolean, is Number -> value.toString()
        else -> value.toString().let { if (plain(it)) it else quoted(it) }
    }

    /** What the YAML 1.2 core schema reads as other than a string. */
    private val NOT_A_STRING = Regex(
        "^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE" +
            "|[-+]?[0-9]+|0o[0-7]+|0x[0-9a-fA-F]+" +
            "|[-+]?(?:\\.[0-9]+|[0-9]+(?:\\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?" +
            "|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$",
    )

    private fun plain(s: String): Boolean {
        if (s.isEmpty() || s != s.trim()) return false
        if (NOT_A_STRING.matches(s)) return false
        // An indicator first, or `-`, `?`, `:` followed by a space or alone.
        if (s[0] in ",[]{}#&*!|>'\"%@`") return false
        if (s[0] in "-?:" && (s.length == 1 || s[1] == ' ' || s[1] == '\t')) return false
        if (s.contains(": ") || s.contains(" #") || s.endsWith(":")) return false
        if (s.any { it == '\n' || it == '\t' || it < ' ' }) return false
        // A flow indicator anywhere is fine in a block context; a document marker is not.
        if (s.startsWith("---") || s.startsWith("...")) return false
        return true
    }

    private fun quoted(s: String): String = buildString {
        append('"')
        for (c in s) when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            '\t' -> append("\\t")
            else -> if (c < ' ') append("\\x%02X".format(c.code)) else append(c)
        }
        append('"')
    }
}
