package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.I18nAddress
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.CommandYaml
import net.artisanmc.plugin.model.CooldownYaml
import net.artisanmc.plugin.model.SubcommandYaml
import java.util.logging.Logger

object CommandCompiler {

    fun compile(yaml: CommandYaml, logger: Logger? = null): CompiledCommand? = runCatching {
        // Canonical wire: keyed steps (a step or a list); a string is the old DSL.
        // A flat list of `{type:…}` actions is the pre-DSL legacy wire.
        val legacy       = yaml.legacyActions
        val steps        = if (legacy.isNotEmpty()) legacy.map { ActionParser.parse(it) }
                           else ActionChainCompiler.compile(yaml.handler, I18nAddress.command(yaml.id))
        // The in-game trigger defaults to the document id when `name` is absent.
        val name         = yaml.name.ifEmpty { yaml.id }
        CompiledCommand(
            name        = name,
            aliases     = yaml.aliases,
            permission  = yaml.permission,
            description = yaml.description,
            argDefs     = ArgDefParser.parseAll(yaml.arguments),
            handler     = handler(yaml.requirements, yaml.fallback, yaml.cooldown, steps, yaml.id.ifEmpty { name }),
            children    = children(yaml.subcommands, yaml.id.ifEmpty { name }, I18nAddress.command(yaml.id), logger),
            console     = yaml.console,
        )
    }.getOrElse { e ->
        logger?.warning("Failed to compile command '${yaml.name}': ${e.message}")
        null
    }

    /**
     * The enabled nodes of [nodes]. A node that does not compile is left out with a warning
     * naming its path: its siblings and its parent stay usable.
     */
    private fun children(nodes: List<SubcommandYaml>, path: String, prefix: String, logger: Logger?): List<CompiledCommand> =
        nodes.filter { it.enabled }.mapNotNull { node ->
            val name = node.name.trim().lowercase()
            val nodePath = "$path $name"
            if (name.isEmpty() || name.contains(' ')) {
                logger?.warning("Command '/$path': a sub-command without a valid name is ignored.")
                return@mapNotNull null
            }
            runCatching {
                val nodePrefix = "$prefix.subcommands.$name"
                CompiledCommand(
                    name        = name,
                    aliases     = node.aliases.map { it.lowercase() },
                    permission  = node.permission,
                    description = node.description,
                    argDefs     = ArgDefParser.parseAll(node.arguments),
                    handler     = handler(node.requirements, node.fallback, node.cooldown,
                                          ActionChainCompiler.compile(node.actions, nodePrefix), nodePath),
                    children    = children(node.subcommands, nodePath, nodePrefix, logger),
                    console     = node.console,
                )
            }.getOrElse { e ->
                logger?.warning("Failed to compile sub-command '/$nodePath': ${e.message}")
                null
            }
        }

    /** A cooldown without an id is the command's own: [path] keeps two commands from sharing it. */
    private fun handler(requirements: List<Map<String, Any>>, fallback: Any?, cooldown: CooldownYaml?, steps: List<Step>, path: String) =
        ClickHandler(
            requirements = requirements.map { ConditionParser.parse(it) },
            fallback     = ActionChainCompiler.compile(fallback),
            cooldown     = cooldown?.let { cy -> Cooldown(cy.id.ifEmpty { path }, cy.duration, cy.scope, cy.message) },
            steps        = steps,
        )
}
