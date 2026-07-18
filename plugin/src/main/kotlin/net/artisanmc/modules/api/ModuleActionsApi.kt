package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.entity.Player

/**
 * Execute a canonical step tree (the wire shape of the editor's `actions`
 * field kit widget: `[{kind: "action", action: {...}}, {kind: "if", ...}]`,
 * literal text) on behalf of a module — e.g. the boutique runs an item's
 * purchase actions after payment succeeds.
 *
 * Runs on the main server thread (dispatched if called from another thread).
 * `args` become placeholder bindings available as `{name}` inside the steps
 * (`player` is always bound implicitly). Malformed steps are skipped with a
 * WARN log — a module's bad data must not break the transaction flow.
 */
@Beta
interface ModuleActionsApi {
    fun execute(player: Player, steps: List<Map<String, Any>>, args: Map<String, Any> = emptyMap())

    companion object {
        /** Inert default (tests / partial wiring). */
        @JvmField
        val NOOP: ModuleActionsApi = object : ModuleActionsApi {
            override fun execute(player: Player, steps: List<Map<String, Any>>, args: Map<String, Any>) {}
        }
    }
}
