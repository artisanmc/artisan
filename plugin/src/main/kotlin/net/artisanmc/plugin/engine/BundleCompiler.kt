package net.artisanmc.plugin.engine

import net.artisanmc.plugin.actiondsl.compileActionDsl
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.MenuYaml
import java.util.logging.Logger

object BundleCompiler {

    fun compile(
        yaml: MenuYaml,
        langMaps: Map<String, Map<String, String>>,
        logger: Logger? = null,
        defaultLang: String = "en",
    ): BundleMenu {
        val compiledAppearances = mutableMapOf<String, List<CompiledAppearance>>()
        val slotToElement = mutableMapOf<Int, String>()

        for (element in yaml.allElements) {
            val slots = parsePositions(element.positionsSpec, yaml.size)
            slots.forEach { slot -> slotToElement[slot] = element.id }

            val compiled = element.appearances.mapNotNull { app ->
                compileAppearance(app, yaml.id, element.id, logger)
            }
            if (compiled.isNotEmpty()) compiledAppearances[element.id] = compiled
        }

        return BundleMenu(yaml, langMaps, compiledAppearances, slotToElement, defaultLang = defaultLang)
    }

    private fun compileAppearance(app: AppearanceYaml, menuId: String, elementId: String, logger: Logger?): CompiledAppearance? =
        runCatching {
            @Suppress("UNCHECKED_CAST")
            val conditions = when (val raw = app.conditions) {
                is Map<*, *> -> listOf(ConditionParser.parse(raw as Map<String, Any>))
                is List<*>   -> raw.map { ConditionParser.parse(it as Map<String, Any>) }
                else         -> emptyList()
            }

            val clicks = app.click.mapNotNull { (key, handlerYaml) ->
                val clickType = ClickType.fromYamlKey(key) ?: return@mapNotNull null
                val requirements = handlerYaml.requirements.map { ConditionParser.parse(it) }
                // Canonical wire (`steps:`) is an Action DSL string (Phase 2, ADR
                // action-dsl) → parsed + mapped to the engine Step tree. The flat
                // `actions:`/`fallback:` keys are the legacy wire and stay as-is.
                val steps        = compileActionDsl(handlerYaml.steps)
                val actions      = handlerYaml.actions.map { ActionParser.parse(it) }
                val fallback     = handlerYaml.fallback.map { ActionParser.parse(it) }
                val cooldown     = handlerYaml.cooldown?.let { cy ->
                    Cooldown(cy.id, cy.duration, cy.scope, cy.message)
                }
                clickType to ClickHandler(requirements, actions, fallback, cooldown, steps)
            }.toMap()

            CompiledAppearance(conditions, clicks, app)
        }.getOrElse { e ->
            logger?.warning("Failed to compile appearance in menu=$menuId element=$elementId: ${e.message}")
            null
        }

    private fun parsePositions(positions: String, size: Int): List<Int> =
        positions.split(",").flatMap { part ->
            val t = part.trim()
            if (t.contains("-")) {
                val (a, b) = t.split("-").map { it.trim().toInt() }
                (a..b).toList()
            } else {
                listOf(t.toIntOrNull() ?: return@flatMap emptyList())
            }
        }.filter { it in 0 until size }
}
