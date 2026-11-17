package net.artisanmc.plugin.engine

import java.util.UUID

/**
 * `record_event` (ADR `stats-foundation` ⑩): one occurrence of the admin's own Stat event
 * `custom:<event>` for the chain's player. The recorder is bound by the plugin ([recorder]);
 * without it (tests, tools) the action does nothing.
 */
object StatActions {
    /** Event name (without `custom:`), player, dimensions, value. */
    @Volatile var recorder: ((String, UUID, Map<String, String>, Double) -> Unit)? = null

    internal fun recordEvent(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val event = Args.str(args, "event")?.trim().orEmpty()
        if (event.isEmpty()) {
            rt.warn("record_event: no `event` — skipped")
            return ctx
        }
        // A dimension's value is a template, read at the moment of the record: `{ quest: "{quest.id}" }`.
        val dimensions = Args.stringMap(args, "dimensions").mapValues { rt.text(EngineActionContext(ctx), it.value) }
        recorder?.invoke(event, ctx.player.uniqueId, dimensions, Args.double(args, "value", 1.0))
        return ctx
    }
}
