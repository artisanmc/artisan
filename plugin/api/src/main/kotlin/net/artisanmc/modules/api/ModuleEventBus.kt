package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
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
    private data class Sub(val type: Class<out ModuleEvent>, val handler: ModuleEventHandler)
    private val subs = CopyOnWriteArrayList<Sub>()

    /**
     * S'abonner aux événements de type [type].
     *
     * A remplacé l'ancien `inline fun <reified T> subscribe(handler: (T) -> Unit)` :
     * une fonction inline reified n'est appelable que depuis Kotlin, et sa
     * signature bytecode exposait un `kotlin.jvm.functions.Function1` sur la
     * surface publique (cf. [ModuleEventHandler]).
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
