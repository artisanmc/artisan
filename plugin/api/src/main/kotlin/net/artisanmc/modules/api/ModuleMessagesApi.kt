package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta

/**
 * Fire-and-forget module messages towards the editor. No-op while disconnected —
 * modules should phrase their UX accordingly ("update lands in a few seconds").
 *
 * NOT a way to change project content (ADR `server-disk-only-storage`). A module that wants to change its own files
 * writes them itself and calls [ProjectContentApi.reload].
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
