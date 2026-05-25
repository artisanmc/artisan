package gg.interfaze.modules.api

import gg.interfaze.modules.api.annotations.Stable
import java.util.concurrent.CopyOnWriteArrayList

/** Marker for events published on the bus. */
@Stable
sealed interface ModuleEvent

/** A module signals that its data source needs to be re-fetched by consumers. */
@Stable
data class DataReloadEvent(val dataSourceRef: String) : ModuleEvent

/** A module's config was hot-reloaded; consumers should refresh references. */
@Stable
data class ConfigReloadEvent(val moduleId: String) : ModuleEvent

@Stable
class ModuleEventBus {
    private data class Sub(val type: Class<out ModuleEvent>, val handler: (ModuleEvent) -> Unit)
    private val subs = CopyOnWriteArrayList<Sub>()

    // Note: inline fun subscribe cannot be annotated with @Stable due to Kotlin's restrictions on
    // annotation targets for inline functions. The function is part of the stable API but the
    // annotation is omitted here to avoid compilation issues.
    inline fun <reified T : ModuleEvent> subscribe(noinline handler: (T) -> Unit) {
        @Suppress("UNCHECKED_CAST")
        subscribeRaw(T::class.java) { handler(it as T) }
    }

    @Stable
    fun subscribeRaw(type: Class<out ModuleEvent>, handler: (ModuleEvent) -> Unit) {
        subs.add(Sub(type, handler))
    }

    @Stable
    fun publish(event: ModuleEvent) {
        for (sub in subs) {
            if (sub.type.isInstance(event)) sub.handler(event)
        }
    }
}
