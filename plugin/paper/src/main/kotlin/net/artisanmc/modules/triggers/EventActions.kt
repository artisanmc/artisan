package net.artisanmc.modules.triggers

import net.artisanmc.modules.api.action.ActionContext
import net.artisanmc.modules.api.action.ActionDeclaration
import net.artisanmc.modules.api.action.ActionRuntime
import net.artisanmc.modules.api.model.ModelField

/**
 * `cancel_event` and `set_event` (ADR `triggers-and-variables` §3 bis): the two actions that change
 * the Game event whose Trigger is running. They act on [TriggerFrames.current]; anywhere else (a
 * menu, a deferred chain) there is no event, and they warn and do nothing.
 */
internal object EventActions {
    fun declarations(): List<ActionDeclaration> = listOf(
        ActionDeclaration("cancel_event") { ctx, _, runtime ->
            val frame = TriggerFrames.current()
            when {
                frame == null -> runtime.warn("cancel_event outside a Trigger: no event to cancel")
                !frame.cancel() -> runtime.warn("cancel_event: '${frame.declaration.name}' cannot be cancelled")
            }
            ctx
        },
        // No declared argument: the argument map is `{<effect>: value}`, the effects of the event
        // the Trigger listens to. The editor renders its own form from the event's declaration.
        ActionDeclaration("set_event") { ctx, args, runtime ->
            val frame = TriggerFrames.current()
            if (frame == null) {
                runtime.warn("set_event outside a Trigger: no event to change")
                return@ActionDeclaration ctx
            }
            for ((name, raw) in args) {
                val effect = frame.declaration.effect(name)
                if (effect == null) {
                    runtime.warn("set_event: '${frame.declaration.name}' has no effect '$name'")
                    continue
                }
                val value = coerce(effect, raw, ctx, runtime)
                if (value == null) {
                    runtime.warn("set_event: '$name' of '${frame.declaration.name}' expects ${effect.type.kind}, got '$raw'")
                    continue
                }
                frame.setEffect(name, value)
            }
            ctx
        },
    )

    /**
     * [raw] as the effect's declared type, templates resolved (`{event.…}`, `{player}`); null when it
     * does not read as that type. Text kinds resolve to the MiniMessage string the event applies.
     */
    fun coerce(effect: ModelField, raw: Any?, ctx: ActionContext, runtime: ActionRuntime): Any? {
        fun text(): String = if (raw is String || raw is Map<*, *>) runtime.text(ctx, raw) else raw?.toString().orEmpty()
        return when (effect.type.kind) {
            "boolean" -> when (raw) {
                is Boolean -> raw
                else -> when (text().trim().lowercase()) {
                    "true", "yes", "1" -> true
                    "false", "no", "0" -> false
                    else -> null
                }
            }
            "integer" -> (raw as? Number)?.toLong() ?: text().trim().toDoubleOrNull()?.toLong()
            "number" -> (raw as? Number)?.toDouble() ?: text().trim().toDoubleOrNull()
            else -> text()
        }
    }
}
