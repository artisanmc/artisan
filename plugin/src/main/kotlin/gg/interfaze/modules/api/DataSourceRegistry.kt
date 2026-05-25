package gg.interfaze.modules.api

import java.util.concurrent.ConcurrentHashMap

class UnknownDataSourceException(ref: String) :
    RuntimeException("No data source registered with ref '$ref'")

class DuplicateDataSourceException(ref: String) :
    IllegalStateException("Data source '$ref' is already registered")

class DataSourceRegistry {
    private val sources = ConcurrentHashMap<String, DataSourceDeclaration>()

    fun register(decl: DataSourceDeclaration) {
        if (sources.putIfAbsent(decl.ref, decl) != null) {
            throw DuplicateDataSourceException(decl.ref)
        }
    }

    fun fetch(ref: String, player: Any, params: Map<String, Any?>): List<Map<String, Any?>> {
        val decl = sources[ref] ?: throw UnknownDataSourceException(ref)
        return decl.fetcher(player, params)
    }

    fun has(ref: String): Boolean = sources.containsKey(ref)

    fun refs(): Set<String> = sources.keys.toSet()
}
