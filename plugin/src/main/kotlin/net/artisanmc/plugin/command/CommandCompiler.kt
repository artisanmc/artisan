package net.artisanmc.plugin.command

import net.artisanmc.plugin.actiondsl.compileActionDsl
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.CommandYaml
import java.util.logging.Logger

object CommandCompiler {

    fun compile(yaml: CommandYaml, logger: Logger? = null): CompiledCommand? = runCatching {
        val requirements = yaml.requirements.map { ConditionParser.parse(it) }
        // Canonical wire (`steps:`) is an Action DSL string (Phase 2, ADR
        // action-dsl); flat `actions:`/`fallback:` are the legacy wire, kept as-is.
        val steps        = compileActionDsl(yaml.steps)
        val actions      = yaml.actions.map { ActionParser.parse(it) }
        val fallback     = yaml.fallback.map { ActionParser.parse(it) }
        val cooldown     = yaml.cooldown?.let { cy -> Cooldown(cy.id, cy.duration, cy.scope, cy.message) }
        val argDefs      = ArgDefParser.parseAll(yaml.arguments)
        CompiledCommand(
            name        = yaml.name,
            aliases     = yaml.aliases,
            permission  = yaml.permission,
            description = yaml.description ?: "",
            argDefs     = argDefs,
            handler     = ClickHandler(requirements, actions, fallback, cooldown, steps),
        )
    }.getOrElse { e ->
        logger?.warning("Failed to compile command '${yaml.name}': ${e.message}")
        null
    }
}
