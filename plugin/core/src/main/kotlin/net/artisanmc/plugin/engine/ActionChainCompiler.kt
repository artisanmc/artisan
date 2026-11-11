package net.artisanmc.plugin.engine

import net.artisanmc.plugin.engine.compileActionDsl

/**
 * Compiles an action chain from its wire (ADR `structured-action-wire`):
 *
 *  - **string** → old Action DSL (legacy); action text is addressed by position
 *    ([assignI18nAddresses], `dslPrefix`) for inline mode.
 *  - `{steps: "<dsl>"}` → same (legacy wrapped form).
 *  - **map / list** → structured keyed wire ([KeyedStepParser]); text is
 *    field-local (no address).
 *
 * Null `dslPrefix` = no addressing (tests, contexts without a site).
 */
object ActionChainCompiler {
    @Suppress("UNCHECKED_CAST")
    fun compile(raw: Any?, dslPrefix: String? = null): List<Step> = when {
        raw is String -> address(compileActionDsl(raw), dslPrefix)
        raw is Map<*, *> && raw["steps"] is String ->
            address(compileActionDsl(raw["steps"] as String), dslPrefix)
        // Pre-DSL legacy wire: a flat list of type-tagged actions (`{type:…}`).
        raw is List<*> && raw.isNotEmpty() &&
            raw.all { it is Map<*, *> && it.containsKey("type") } ->
            raw.map { ActionParser.parse(it as Map<String, Any>) }
        else -> KeyedStepParser.parseKeyed(raw)
    }

    private fun address(steps: List<Step>, prefix: String?): List<Step> =
        if (prefix == null) steps else assignI18nAddresses(steps, prefix)
}
