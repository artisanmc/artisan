package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable
import org.bukkit.entity.Player
import java.util.concurrent.ConcurrentHashMap

@Stable
class UnknownDataSourceException(ref: String) :
    RuntimeException("No data source registered with ref '$ref'")

@Stable
class DuplicateDataSourceException(ref: String) :
    IllegalStateException("Data source '$ref' is already registered")

/** A registered declaration plus the module that owns it (null = registered outside a module's onEnable). */
@Stable
data class RegisteredDataSource(val declaration: DataSourceDeclaration, val moduleId: String?)

@Stable
class DataSourceRegistry {
    private val sources = ConcurrentHashMap<String, RegisteredDataSource>()

    /**
     * Owner captured for registrations happening right now. Set by
     * [ModuleRegistry.register] around `onEnable` (main-thread sequential),
     * null for direct registrations (third-party plugins via ServicesManager).
     */
    @Volatile internal var currentOwner: String? = null

    @Stable
    fun register(decl: DataSourceDeclaration) {
        if (sources.putIfAbsent(decl.ref, RegisteredDataSource(decl, currentOwner)) != null) {
            throw DuplicateDataSourceException(decl.ref)
        }
    }

    /** Removes the data source [ref]; false if none was registered. Since 1.8.0. */
    @Stable
    fun unregister(ref: String): Boolean = sources.remove(ref) != null

    internal fun unregisterOwnedBy(moduleId: String) {
        sources.values.removeIf { it.moduleId == moduleId }
    }

    internal fun unregisterLoadedBy(loader: ClassLoader) {
        sources.values.removeIf { it.declaration.fetcher.javaClass.classLoader === loader }
    }

    @Stable
    fun fetch(ref: String, player: Player?, params: Map<String, Any?>): List<Map<String, Any?>> {
        val entry = sources[ref] ?: throw UnknownDataSourceException(ref)
        return entry.declaration.fetcher.fetch(player, params)
    }

    @Stable
    fun has(ref: String): Boolean = sources.containsKey(ref)

    @Stable
    fun refs(): Set<String> = sources.keys.toSet()

    @Stable
    fun declarations(): List<DataSourceDeclaration> =
        sources.values.map { it.declaration }.sortedBy { it.ref }

    /** Declarations with their owning module id, sorted by ref. */
    @Stable
    fun registered(): List<RegisteredDataSource> =
        sources.values.sortedBy { it.declaration.ref }
}
