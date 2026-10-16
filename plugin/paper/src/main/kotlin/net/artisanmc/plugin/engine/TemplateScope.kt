package net.artisanmc.plugin.engine

import net.artisanmc.plugin.expr.ExprScope
import net.artisanmc.plugin.expr.evaluateExpr
import net.artisanmc.plugin.expr.parseExpr
import net.artisanmc.plugin.expr.renderTemplate
import net.artisanmc.plugin.model.LocalizedText
import org.bukkit.World
import org.bukkit.entity.Player

/**
 * The seam between the runtime's context and the platform-agnostic Expression
 * engine (ADR `expression-parity`).
 *
 * The editor binds plain maps; the server binds live Bukkit objects. Rather than
 * leak Bukkit into `expr`, those objects are adapted here into map-like values
 * whose `toString` is what a bare `{player}` should render — so `{player}` gives
 * the name and `{player.uuid}` the id, exactly as in the editor's preview where
 * the sample player is a map with a custom `toString`.
 */
private class BukkitValue(
    private val fields: Map<String, Any?>,
    private val display: String,
) : Map<String, Any?> by fields {
    override fun toString(): String = display
}

/** A scope over plain args — no ExecutionContext, no PAPI (params/filter interpolation). */
fun argsScope(args: Map<String, Any?>): ExprScope = ExprScope(args.mapValues { adapt(it.value) })

internal fun adapt(value: Any?): Any? = when (value) {
    is Player -> BukkitValue(
        mapOf("name" to value.name, "uuid" to value.uniqueId.toString(), "world" to value.world.name),
        value.name,
    )
    is World -> BukkitValue(mapOf("name" to value.name), value.name)
    else -> value
}

/**
 * Args as the Expression engine sees them, with Bukkit values adapted.
 *
 * [translate] feeds the presentation keys (`artisan.duration.*`) from the
 * project's `lang/`, so `until()` speaks the viewer's language like every other
 * string (ADR `expression-parity` §7).
 */
fun ExecutionContext.exprScope(
    papi: PapiProvider?,
    translate: (String) -> String? = { null },
): ExprScope {
    val resolver: ((String) -> String?)? = papi?.let { p -> { name -> p.resolve(player, "%$name%") } }
    return ExprScope(
        resolvedArgs.mapValues { adapt(it.value) },
        resolver,
        null,
        null,
        translate,
    )
}

/**
 * Render a Template against this context — the one entry point for every
 * player-facing string (item name, lore, title, material, dialog text, action
 * text). [i18nLookup] resolves `{i18n:key}` against the viewer's language.
 */
fun ExecutionContext.render(
    template: String,
    papi: PapiProvider? = null,
    i18nLookup: (String) -> String? = { null },
): String = renderTemplate(template, exprScope(papi, i18nLookup), i18nLookup)

/**
 * Raw value of an expression — used where the context must stay **typed** rather
 * than become text (`context: { cat: "{cat}" }` passes the whole row Map, not its
 * rendering). Null when it cannot be resolved.
 */
fun ExecutionContext.exprValue(expr: String, papi: PapiProvider? = null): Any? =
    runCatching { evaluateExpr(parseExpr(expr), exprScope(papi)) }.getOrNull()

/**
 * The lookup chain of a BARE text (ADR `field-local-translations`): an explicit
 * `{i18n:key}` ref wins; otherwise the literal is looked up at its canonical
 * ADDRESS (inline mode — the literal is the default language, the other
 * languages sit at `address` in `lang/<lang>.yaml`); otherwise the literal
 * stands as written. The one implementation of the rule for the menu, dialog
 * and action texts; interpolation (`{arg}`, `%papi%`) comes after, per caller.
 */
fun lookupLocalized(value: String, langMap: Map<String, String>, address: String? = null): String =
    if (value.startsWith("{i18n:")) langMap[value.removePrefix("{i18n:").removeSuffix("}")] ?: value
    else address?.let { langMap[it] } ?: value

/**
 * A text slot for this context's viewer, against its [ExecutionContext.langMap]:
 * a field-local map is authoritative (its entry for [ExecutionContext.lang],
 * falling back to [ExecutionContext.defaultLang]); a bare value goes through
 * [lookupLocalized]. `null` when the slot holds nothing for any language.
 */
fun ExecutionContext.localize(text: LocalizedText, address: String? = null): String? {
    val value = text.forLang(lang, defaultLang) ?: return null
    return if (text.isMap) value else lookupLocalized(value, langMap, address)
}
