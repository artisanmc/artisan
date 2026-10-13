package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.entity.Player

/**
 * Execute an **Action DSL string** (the module-data `actions` wire, see ADR
 * `action-dsl`) on behalf of a module, e.g. the shop runs an item's purchase
 * actions after payment succeeds. The string is parsed via the shared Action DSL
 * codec and mapped to the engine.
 *
 * Runs on the main server thread (dispatched if called from another thread).
 * `args` become placeholder bindings available as `{name}` inside the actions
 * (`player` is always bound implicitly). A malformed / empty / unparseable
 * string is skipped with a WARN log — a module's bad data must not break the
 * transaction flow.
 *
 * `projectId` puts the project in scope for i18n: an action can then carry
 * `@key`, resolved from that project's `lang/` (ADR `yaml-assisted-editing`).
 * Without it, texts stay literal.
 */
@Beta
interface ModuleActionsApi {
    fun execute(
        player: Player,
        actions: String,
        args: Map<String, Any> = emptyMap(),
        projectId: String? = null,
    )

    companion object {
        /** Inert default (tests / partial wiring). */
        @JvmField
        val NOOP: ModuleActionsApi = object : ModuleActionsApi {
            override fun execute(
                player: Player,
                actions: String,
                args: Map<String, Any>,
                projectId: String?,
            ) {}
        }
    }
}
