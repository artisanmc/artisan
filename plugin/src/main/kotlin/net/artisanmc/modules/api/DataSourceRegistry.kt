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

@Stable
class DataSourceRegistry {
    private val sources = ConcurrentHashMap<String, DataSourceDeclaration>()

    @Stable
    fun register(decl: DataSourceDeclaration) {
        if (sources.putIfAbsent(decl.ref, decl) != null) {
            throw DuplicateDataSourceException(decl.ref)
        }
    }

    @Stable
    fun fetch(ref: String, player: Player, params: Map<String, Any?>): List<Map<String, Any?>> {
        val decl = sources[ref] ?: throw UnknownDataSourceException(ref)
        return decl.fetcher(player, params)
    }

    @Stable
    fun has(ref: String): Boolean = sources.containsKey(ref)

    @Stable
    fun refs(): Set<String> = sources.keys.toSet()

    @Stable
    fun declarations(): List<DataSourceDeclaration> = sources.values.sortedBy { it.ref }
}
