package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Marker for events published on the bus. Add-ons may define their own events by
 * implementing it (open since 1.8.0, sealed before).
 */
@Stable
interface ModuleEvent

/**
 * A module signals that its data source needs to be re-fetched by consumers.
 * Artisan neither publishes nor consumes it (menus re-fetch on every render):
 * it is for add-ons that cache another add-on's rows.
 */
@Stable
data class DataReloadEvent(val dataSourceRef: String) : ModuleEvent

/** A module's config was hot-reloaded; consumers should refresh references. */
@Stable
data class ConfigReloadEvent(val moduleId: String) : ModuleEvent

@Stable
class ModuleEventBus {
    private data class Sub(val type: Class<out ModuleEvent>, val handler: ModuleEventHandler)
    private val subs = CopyOnWriteArrayList<Sub>()

    /**
     * Subscribe to events of type [type].
     *
     * Takes a `Class` rather than a reified type parameter: an inline reified
     * function is callable from Kotlin only, and its bytecode signature exposed a
     * `kotlin.jvm.functions.Function1` on the public surface (see [ModuleEventHandler]).
     */
    @Stable
    fun subscribe(type: Class<out ModuleEvent>, handler: ModuleEventHandler) {
        subs.add(Sub(type, handler))
    }

    @Stable
    fun publish(event: ModuleEvent) {
        for (sub in subs) {
            if (sub.type.isInstance(event)) sub.handler.onEvent(event)
        }
    }
}
