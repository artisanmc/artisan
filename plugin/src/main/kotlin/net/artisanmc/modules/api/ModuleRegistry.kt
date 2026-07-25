package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Internal
import net.artisanmc.modules.api.annotations.Stable
import java.util.concurrent.CopyOnWriteArrayList

/** Thrown when a module id is registered twice. */
@Stable
class DuplicateModuleException(id: String) : IllegalArgumentException("Module '$id' is already registered")

/**
 * Runtime registry for [ArtisanModule]s. Modules obtained via Bukkit ServicesManager
 * call [register] to activate; the registry calls [ArtisanModule.onEnable] and signals
 * [onChange] so the plugin can push a `modules_changed` WS frame.
 *
 * Must be [bind]ed to an [ArtisanAPI] before [register] is called.
 */
@Stable
class ModuleRegistry {
    private val _active: CopyOnWriteArrayList<ArtisanModule> = CopyOnWriteArrayList()
    private var api: ArtisanAPI? = null
    private var onChange: (() -> Unit)? = null

    /**
     * Bind this registry to the live [ArtisanAPI] and the [onChange] callback that
     * fires whenever the active module list changes. Called once at plugin enable.
     */
    @Internal
    fun bind(api: ArtisanAPI, onChange: () -> Unit) {
        this.api = api
        this.onChange = onChange
    }

    /**
     * Register [module] and call its [ArtisanModule.onEnable]. Signals [onChange].
     * Throws [IllegalStateException] if not yet [bind]ed, [DuplicateModuleException]
     * if a module with the same id is already registered.
     */
    @Stable
    fun register(module: ArtisanModule) {
        val boundApi = api ?: error("ModuleRegistry must be bound before registering modules")
        synchronized(_active) {
            if (_active.any { it.id == module.id }) throw DuplicateModuleException(module.id)
            _active.add(module)
        }
        boundApi.dataSources.currentOwner = module.id
        boundApi.models.currentOwner = module.id
        try {
            module.onEnable(boundApi)
        } finally {
            boundApi.dataSources.currentOwner = null
            boundApi.models.currentOwner = null
        }
        onChange?.invoke()
    }

    /** Returns an immutable snapshot of currently active modules. */
    @Stable
    fun active(): List<ArtisanModule> = _active.toList()

    /** Returns true if a module with [id] is registered. */
    @Stable
    fun has(id: String): Boolean = _active.any { it.id == id }
}
