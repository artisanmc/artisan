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
 * [onChange] so the plugin can push a `modules_changed` WS frame. [unregister] undoes it.
 *
 * Must be [bind]ed to an [ArtisanAPI] before [register] is called.
 */
@Stable
class ModuleRegistry {
    private val _active: CopyOnWriteArrayList<ArtisanModule> = CopyOnWriteArrayList()
    private var api: ArtisanAPI? = null
    private var onChange: Runnable? = null

    /**
     * Bind this registry to the live [ArtisanAPI] and the [onChange] callback that
     * fires whenever the active module list changes. Called once at plugin enable.
     */
    @Internal
    fun bind(api: ArtisanAPI, onChange: Runnable) {
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
        setOwner(boundApi, module.id)
        try {
            module.onEnable(boundApi)
        } finally {
            setOwner(boundApi, null)
        }
        onChange?.run()
    }

    /**
     * Unregister the module [id]: calls its [ArtisanModule.onDisable], then removes the
     * data sources, commands, models and screens it registered from its `onEnable`.
     * Signals [onChange]. Returns false if no such module is registered. Since 1.8.0.
     *
     * Artisan does it on its own when the plugin that loaded the module disables.
     */
    @Stable
    fun unregister(id: String): Boolean {
        val module = synchronized(_active) {
            _active.firstOrNull { it.id == id }?.also { _active.remove(it) }
        } ?: return false
        try {
            module.onDisable()
        } finally {
            api?.let {
                it.dataSources.unregisterOwnedBy(id)
                it.commands.unregisterOwnedBy(id)
                it.models.unregisterOwnedBy(id)
                it.screens.unregisterOwnedBy(id)
            }
            onChange?.run()
        }
        return true
    }

    /**
     * Unregister everything a disabling plugin left behind: its modules (see
     * [unregister]), then the data sources and commands whose callback was loaded
     * by [loader]. Returns the failures of modules' `onDisable`, for the caller to log.
     */
    @Internal
    fun unregisterLoadedBy(loader: ClassLoader): List<Exception> {
        val failures = mutableListOf<Exception>()
        for (module in active().filter { it.javaClass.classLoader === loader }) {
            try {
                unregister(module.id)
            } catch (e: Exception) {
                failures += IllegalStateException("Module '${module.id}' failed to disable", e)
            }
        }
        api?.let {
            it.dataSources.unregisterLoadedBy(loader)
            it.commands.unregisterLoadedBy(loader)
        }
        return failures
    }

    private fun setOwner(api: ArtisanAPI, moduleId: String?) {
        api.dataSources.currentOwner = moduleId
        api.commands.currentOwner = moduleId
        api.models.currentOwner = moduleId
        api.screens.currentOwner = moduleId
    }

    /** Returns an immutable snapshot of currently active modules. */
    @Stable
    fun active(): List<ArtisanModule> = _active.toList()

    /** Returns true if a module with [id] is registered. */
    @Stable
    fun has(id: String): Boolean = _active.any { it.id == id }
}
