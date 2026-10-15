package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.ActionContext
import net.artisanmc.modules.api.ActionRuntime
import net.artisanmc.plugin.model.LocalizedText
import org.bukkit.Bukkit

/**
 * What the engine lends a handler for one step (API [ActionRuntime]): text resolution,
 * nested chains, warnings. Built per step so it carries the step's legacy i18n addresses
 * ([Step.ActionStep.i18n]); the core handlers also reach the [executor] through it.
 */
class EngineRuntime(
    val executor: ActionExecutor,
    private val i18n: Map<String, String> = emptyMap(),
) : ActionRuntime {

    override fun text(ctx: ActionContext, text: Any?): String {
        val ltext = Args.ltext(text) ?: return ""
        return executor.resolveText(ltext, executor.context(ctx))
    }

    /** A core handler's `ltext` argument, looked up at its legacy address when the step has one. */
    fun text(ctx: ExecutionContext, args: Map<String, Any>, name: String): String {
        val ltext = Args.ltext(args[name]) ?: return ""
        return executor.resolveText(ltext, ctx, i18n[name])
    }

    override fun run(ctx: ActionContext, chain: Any?): ActionContext {
        val base = executor.context(ctx)
        if (chain == null) return EngineActionContext(base)
        val steps = runCatching { ActionChainCompiler.compile(chain) }.getOrElse {
            warn("action chain failed to parse: ${it.message}")
            return EngineActionContext(base)
        }
        return EngineActionContext(executor.executeSteps(steps, base))
    }

    override fun warn(message: String) {
        Bukkit.getLogger().warning("[Artisan] $message")
    }
}

/** Typed reads of a bound argument map (YAML and JSON hand numbers as Int, Long or Double). */
object Args {
    fun str(args: Map<String, Any>, name: String): String? = args[name]?.toString()
    fun int(args: Map<String, Any>, name: String, default: Int): Int = (args[name] as? Number)?.toInt() ?: default
    fun double(args: Map<String, Any>, name: String, default: Double): Double = (args[name] as? Number)?.toDouble() ?: default
    fun float(args: Map<String, Any>, name: String, default: Float): Float = (args[name] as? Number)?.toFloat() ?: default
    fun bool(args: Map<String, Any>, name: String, default: Boolean): Boolean = when (val v = args[name]) {
        is Boolean -> v
        is String -> v.equals("true", ignoreCase = true)
        else -> default
    }

    /** A `map(string)` argument (`context`): string keys, stringified values. */
    fun stringMap(args: Map<String, Any>, name: String): Map<String, String> =
        (args[name] as? Map<*, *>)?.entries
            ?.filter { it.key != null && it.value != null }
            ?.associate { it.key.toString() to it.value.toString() }
            ?: emptyMap()

    /** An `ltext` value: a literal in the default language, or a `{lang: text}` map. */
    fun ltext(value: Any?): LocalizedText? = when (value) {
        null -> null
        is LocalizedText -> value
        is Map<*, *> -> LocalizedText.ofMap(
            value.entries.filter { it.key != null && it.value != null }.associate { it.key.toString() to it.value.toString() },
        )
        else -> LocalizedText.of(value.toString())
    }

    /** A `list(ltext)` argument (`lore`): a single text counts as a one-line list. */
    fun ltextList(args: Map<String, Any>, name: String): List<LocalizedText> = when (val v = args[name]) {
        null -> emptyList()
        is List<*> -> v.mapNotNull { ltext(it) }
        else -> listOfNotNull(ltext(v))
    }
}
