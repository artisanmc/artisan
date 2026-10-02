package net.artisanmc.plugin.engine

import net.artisanmc.plugin.actiondsl.compileActionDsl

/**
 * Compile une chaîne d'actions depuis son wire (ADR `structured-action-wire`) :
 *
 *  - **string** → ancien Action DSL (legacy) ; le texte d'action y est adressé
 *    par position ([assignI18nAddresses], `dslPrefix`) pour le mode inline.
 *  - `{steps: "<dsl>"}` → idem (forme legacy enveloppée).
 *  - **map / liste** → wire keyed structuré ([KeyedStepParser]) ; le texte est
 *    field-local (aucune adresse).
 *
 * `dslPrefix` nul = pas d'adressage (tests, contextes sans site).
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
            raw.map { Step.ActionStep(ActionParser.parse(it as Map<String, Any>)) }
        else -> KeyedStepParser.parseKeyed(raw)
    }

    private fun address(steps: List<Step>, prefix: String?): List<Step> =
        if (prefix == null) steps else assignI18nAddresses(steps, prefix)
}
