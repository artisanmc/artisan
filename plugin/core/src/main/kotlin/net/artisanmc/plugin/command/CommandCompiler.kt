package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.compileActionDsl
import net.artisanmc.plugin.engine.I18nAddress
import net.artisanmc.plugin.engine.assignI18nAddresses
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.CommandYaml
import java.util.logging.Logger

object CommandCompiler {

    fun compile(yaml: CommandYaml, logger: Logger? = null): CompiledCommand? = runCatching {
        val requirements = yaml.requirements.map { ConditionParser.parse(it) }
        // Canonical wire: keyed steps (a step or a list); a string is the old DSL.
        // A flat list of `{type:…}` actions is the pre-DSL legacy wire.
        val legacy       = yaml.legacyActions
        val steps        = if (legacy.isNotEmpty()) legacy.map { ActionParser.parse(it) }
                           else ActionChainCompiler.compile(yaml.handler, I18nAddress.command(yaml.id))
        val fallback     = ActionChainCompiler.compile(yaml.fallback)
        val cooldown     = yaml.cooldown?.let { cy -> Cooldown(cy.id, cy.duration, cy.scope, cy.message) }
        val argDefs      = ArgDefParser.parseAll(yaml.arguments)
        CompiledCommand(
            // The in-game trigger defaults to the document id when `name` is absent.
            name        = yaml.name.ifEmpty { yaml.id },
            aliases     = yaml.aliases,
            permission  = yaml.permission,
            description = yaml.description ?: "",
            argDefs     = argDefs,
            handler     = ClickHandler(requirements, fallback, cooldown, steps),
        )
    }.getOrElse { e ->
        logger?.warning("Failed to compile command '${yaml.name}': ${e.message}")
        null
    }
}
