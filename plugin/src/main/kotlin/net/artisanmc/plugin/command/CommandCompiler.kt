package net.artisanmc.plugin.command

import net.artisanmc.plugin.actiondsl.compileActionDsl
import net.artisanmc.plugin.engine.I18nAddress
import net.artisanmc.plugin.engine.assignI18nAddresses
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.CommandYaml
import java.util.logging.Logger

object CommandCompiler {

    fun compile(yaml: CommandYaml, logger: Logger? = null): CompiledCommand? = runCatching {
        val requirements = yaml.requirements.map { ConditionParser.parse(it) }
        // Canonical wire (`actions:`) is an Action DSL string (`steps:` is the
        // legacy spelling); a flat action-map list in `actions:` is the pre-DSL
        // legacy wire, kept as-is.
        val steps        = assignI18nAddresses(compileActionDsl(yaml.dsl), I18nAddress.command(yaml.id))
        val actions      = yaml.legacyActions.map { ActionParser.parse(it) }
        val fallback     = yaml.fallback.map { ActionParser.parse(it) }
        val cooldown     = yaml.cooldown?.let { cy -> Cooldown(cy.id, cy.duration, cy.scope, cy.message) }
        val argDefs      = ArgDefParser.parseAll(yaml.arguments)
        CompiledCommand(
            // The in-game trigger defaults to the document id when `name` is absent.
            name        = yaml.name.ifEmpty { yaml.id },
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
