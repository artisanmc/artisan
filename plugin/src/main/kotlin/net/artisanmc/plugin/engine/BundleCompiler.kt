package net.artisanmc.plugin.engine

import net.artisanmc.plugin.actiondsl.compileActionDsl
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.expr.warmTemplate
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

            // RESOLUTION order — states first, display last: the renderer takes
            // the first appearance whose `if` passes, and the display is the
            // fallback that always does. The i18n index stays the ADDRESSING one
            // (0 = display = `default`, N = states[N - 1]), so a state's key
            // sites don't move when another state is inserted before it.
            // Cf. ADR `element-display-and-states`.
            val compiled =
                element.states.mapIndexedNotNull { i, app ->
                    warnIncompleteState(app, yaml.id, element.id, i, logger)
                    compileAppearance(app, yaml.id, element.id, i + 1, logger)
                } + listOfNotNull(compileAppearance(element.display, yaml.id, element.id, 0, logger))
            if (compiled.isNotEmpty()) compiledAppearances[element.id] = compiled
        }

        return BundleMenu(yaml, langMaps, compiledAppearances, slotToElement, defaultLang = defaultLang)
    }

    /** @see I18nAddress.state — kept as an alias for existing callers. */
    fun stateLabel(index: Int): String = I18nAddress.state(index)

    /**
     * A state is a WHOLE appearance, not a patch on the display — so one that
     * names no item renders a bare stone block (`MenuRenderer` falls back to
     * STONE), silently. Written by hand it is almost always a merge that was
     * expected and didn't happen; one WARN at load makes it findable after the
     * fact. The render is left alone on purpose: "state ignored" would be a
     * third rule to remember.
     */
    private fun warnIncompleteState(
        app: AppearanceYaml,
        menuId: String,
        elementId: String,
        stateIndex: Int,
        logger: Logger?,
    ) {
        if (app.image != null || app.item != null || app.material != null || app.head != null) return
        logger?.warning(
            "menu=$menuId element=$elementId state${stateIndex + 1} names no material — it will render as STONE. " +
                "A state replaces the display entirely; it inherits nothing from it.",
        )
    }

    private fun compileAppearance(
        app: AppearanceYaml,
        menuId: String,
        elementId: String,
        appIndex: Int,
        logger: Logger?,
    ): CompiledAppearance? =
        runCatching {
            @Suppress("UNCHECKED_CAST")
            val conditions = when (val raw = app.conditions) {
                is Map<*, *> -> listOf(ConditionParser.parse(raw as Map<String, Any>))
                is List<*>   -> raw.map { ConditionParser.parse(it as Map<String, Any>) }
                else         -> emptyList()
            }

            val base = I18nAddress.appearance(menuId, elementId, appIndex)
            val clicks = app.click.mapNotNull { (key, handlerYaml) ->
                val clickType = ClickType.fromYamlKey(key) ?: return@mapNotNull null
                val requirements = handlerYaml.requirements.map { ConditionParser.parse(it) }
                // Canonical wire (`steps:`) is an Action DSL string (Phase 2, ADR
                // action-dsl) → parsed + mapped to the engine Step tree. The flat
                // `actions:`/`fallback:` keys are the legacy wire and stay as-is.
                // Addresses key on the WIRE click key, like the editor's visitor.
                val steps        = assignI18nAddresses(compileActionDsl(handlerYaml.steps), I18nAddress.clickHandler(base, key))
                val actions      = handlerYaml.actions.map { ActionParser.parse(it) }
                val fallback     = handlerYaml.fallback.map { ActionParser.parse(it) }
                val cooldown     = handlerYaml.cooldown?.let { cy ->
                    Cooldown(cy.id, cy.duration, cy.scope, cy.message)
                }
                clickType to ClickHandler(requirements, actions, fallback, cooldown, steps)
            }.toMap()

            // Parse the appearance's Templates now: the cache is warm before the
            // first render, and a malformed expression is reported here — with its
            // menu and element — rather than as a ⚠️ in some player's inventory.
            warnMalformedTemplates(app, menuId, elementId, logger)

            CompiledAppearance(conditions, clicks, app, base)
        }.getOrElse { e ->
            logger?.warning("Failed to compile appearance in menu=$menuId element=$elementId: ${e.message}")
            null
        }

    private fun warnMalformedTemplates(
        app: AppearanceYaml,
        menuId: String,
        elementId: String,
        logger: Logger?,
    ) {
        if (logger == null) return
        val templates = listOfNotNull(app.item, app.material, app.head, app.title) + app.lore
        for (template in templates) {
            for (problem in warmTemplate(template)) {
                logger.warning("[Artisan] menu=$menuId element=$elementId: malformed expression $problem")
            }
        }
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
