package net.artisanmc.plugin.command

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.plugin.model.CommandYaml
import net.artisanmc.plugin.model.YamlFiles
import net.artisanmc.plugin.project.EditorYaml

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

    /** The action that runs a declared command's code. */
    const val ACTION = "module_command"

    /** `commands/<name>.yml`: the document id is the command's name. */
    fun path(declaration: PlayerCommandDeclaration): String = "commands/${declaration.name}${YamlFiles.EXT}"

    /** The template of [declarations] (a module's root commands), or null when it declares none. */
    fun template(declarations: List<PlayerCommandDeclaration>): TemplateDeclaration? {
        if (declarations.isEmpty()) return null
        val builder = TemplateDeclaration.builder(TEMPLATE_ID, 1).title("Commands").system()
        // A second root of the same name would be the same file: the first keeps it.
        declarations.distinctBy { it.name }.forEach { builder.file(path(it), yaml(it).toByteArray(Charsets.UTF_8)) }
        return builder.build()
    }

    fun yaml(declaration: PlayerCommandDeclaration): String = EditorYaml.write(document(declaration))

    /** The file as the plugin reads it, its id the file name: what runs while it is on no disk. */
    fun commandYaml(declaration: PlayerCommandDeclaration): CommandYaml =
        mapper.readValue(yaml(declaration), CommandYaml::class.java).copy(id = declaration.name)

    /** The declared arguments, typed as the generated file types them. */
    fun argDefs(declaration: PlayerCommandDeclaration): List<ArgDef> =
        ArgDefParser.parseAll(declaration.arguments.map { arg -> argument(arg).mapNotNull { (k, v) -> v?.let { k to it } }.toMap() })

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    /**
     * The root document, without `id` (the file name) nor `name` (equal to it). [dress] changes
     * each node's map once built, its sub-commands' included (the overrides' migration).
     */
    fun document(
        declaration: PlayerCommandDeclaration,
        dress: (PlayerCommandDeclaration, MutableMap<String, Any?>) -> Unit = { _, _ -> },
    ): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>("schema" to "command/v1")
        // A command without code nor menu only lists its sub-commands: the editor still writes `actions: []`.
        out["actions"] = actions(declaration)
        out.putAll(fields(declaration, dress))
        dress(declaration, out)
        return out
    }

    private fun subcommand(declaration: PlayerCommandDeclaration, dress: (PlayerCommandDeclaration, MutableMap<String, Any?>) -> Unit): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>("name" to declaration.name)
        actions(declaration).takeIf { it.isNotEmpty() }?.let { out["actions"] = it }
        out.putAll(fields(declaration, dress))
        dress(declaration, out)
        return out
    }

    private fun actions(declaration: PlayerCommandDeclaration): List<Map<String, Any?>> = when {
        declaration.executor != null -> listOf(mapOf(ACTION to declaration.id))
        declaration.opensMenu != null -> listOf(mapOf("open_menu" to declaration.opensMenu))
        else -> emptyList()
    }

    /** What a command and a sub-command write alike, in the editor's order; `console` last, as a key it keeps as read. */
    private fun fields(declaration: PlayerCommandDeclaration, dress: (PlayerCommandDeclaration, MutableMap<String, Any?>) -> Unit): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>()
        if (declaration.aliases.isNotEmpty()) out["aliases"] = declaration.aliases
        declaration.permission?.let { out["permission"] = it }
        description(declaration.description)?.let { out["description"] = it }
        if (declaration.arguments.isNotEmpty()) out["arguments"] = declaration.arguments.map(::argument)
        if (declaration.children.isNotEmpty()) out["subcommands"] = declaration.children.map { subcommand(it, dress) }
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
