package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.entity.Player

/**
 * Execute an **Action DSL string** (the module-data `actions` wire — cf. ADR
 * `action-dsl`) on behalf of a module — e.g. the boutique runs an item's
 * purchase actions after payment succeeds. The string is parsed via the shared
 * Action DSL codec and mapped to the engine, replacing the old structured
 * `[{kind:"action",...}]` step tree.
 *
 * Runs on the main server thread (dispatched if called from another thread).
 * `args` become placeholder bindings available as `{name}` inside the actions
 * (`player` is always bound implicitly). A malformed / empty / unparseable
 * string is skipped with a WARN log — a module's bad data must not break the
 * transaction flow.
 *
 * `projectId` met le project en portée pour l'i18n : une action peut alors
 * porter `@clé`, résolue dans les `lang/` de ce project (ADR
 * `yaml-assisted-editing` ④). Sans lui, les textes restent littéraux.
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
