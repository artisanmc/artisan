package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta

/**
 * Fire-and-forget module messages over the plugin ↔ backend WS. The backend
 * routes by `type` to the module's backend layer (e.g. `boutique_additem` →
 * the boutique backend module mutates the project). No-op while disconnected —
 * modules should phrase their UX accordingly ("update lands in a few seconds").
 */
@Beta
interface ModuleMessagesApi {
    fun send(type: String, payload: Map<String, Any?>)

    companion object {
        /** Inert default (tests / partial wiring). */
        @JvmField
        val NOOP: ModuleMessagesApi = object : ModuleMessagesApi {
            override fun send(type: String, payload: Map<String, Any?>) {}
        }
    }
}
