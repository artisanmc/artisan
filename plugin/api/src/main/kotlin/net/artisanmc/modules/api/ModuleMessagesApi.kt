package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import net.artisanmc.modules.api.annotations.Sunset

/**
 * Fire-and-forget module messages towards the editor. Nothing receives them since
 * the editor moved into the plugin: a leaf forwards them to the hub, which ignores
 * unknown types, and the hub relays them nowhere.
 *
 * NOT a way to change project content (ADR `server-disk-only-storage`). A module that wants to change its own files
 * writes them itself and calls [ProjectContentApi.reload].
 */
@Beta
@Sunset(reason = "No receiver since the editor moved into the plugin", removeInVersion = "2.0.0")
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
