package gg.interfaze.modules.api

import java.util.concurrent.CopyOnWriteArrayList

/** Marker for events published on the bus. */
sealed interface ModuleEvent

/** A module signals that its data source needs to be re-fetched by consumers. */
data class DataReloadEvent(val dataSourceRef: String) : ModuleEvent

/** A module's config was hot-reloaded; consumers should refresh references. */
data class ConfigReloadEvent(val moduleId: String) : ModuleEvent

class ModuleEventBus {
    private data class Sub(val type: Class<out ModuleEvent>, val handler: (ModuleEvent) -> Unit)
    private val subs = CopyOnWriteArrayList<Sub>()

    inline fun <reified T : ModuleEvent> subscribe(noinline handler: (T) -> Unit) {
        @Suppress("UNCHECKED_CAST")
        subscribeRaw(T::class.java) { handler(it as T) }
    }

    fun subscribeRaw(type: Class<out ModuleEvent>, handler: (ModuleEvent) -> Unit) {
        subs.add(Sub(type, handler))
    }

    fun publish(event: ModuleEvent) {
        for (sub in subs) {
            if (sub.type.isInstance(event)) sub.handler(event)
        }
    }
}
