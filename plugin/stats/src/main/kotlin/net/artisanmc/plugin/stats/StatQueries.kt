package net.artisanmc.plugin.stats

import net.artisanmc.modules.api.stats.StatQuery
import java.util.concurrent.ConcurrentHashMap

/**
 * The figures modules compute on demand (`StatsApi.declareQuery`, ADR `stats-foundation` ⑪): each
 * answer is kept for its query's cache time, per set of parameters, so a tab several admins have
 * open asks the module once. [run] blocks on the module's code: call it off the game threads.
 */
class StatQueries(private val clock: () -> Long = System::currentTimeMillis) {
    private class Declared(val cacheMillis: Long, val query: StatQuery)

    /** The rows of an answer and when they were computed (epoch ms). */
    data class Answer(val rows: List<Map<String, Any?>>, val computedAt: Long)

    private val declared = ConcurrentHashMap<String, Declared>()
    private val cache = ConcurrentHashMap<String, Answer>()

    fun declare(id: String, cacheSeconds: Int, query: StatQuery) {
        require(cacheSeconds in 0..MAX_CACHE_SECONDS) { "Stat query $id: a cache time of 0 to $MAX_CACHE_SECONDS seconds" }
        declared[id] = Declared(cacheSeconds * 1000L, query)
        cache.keys.removeIf { it.startsWith("$id?") }
    }

    fun ids(): List<String> = declared.keys.sorted()

    /** The answer of [id] for [params], from the cache while it is fresh; null for an undeclared query. Throws what the module throws. */
    fun run(id: String, params: Map<String, String>): Answer? {
        val query = declared[id] ?: return null
        val key = id + "?" + Dimensions.encode(params)
        val now = clock()
        cache[key]?.takeIf { now - it.computedAt < query.cacheMillis }?.let { return it }
        val answer = Answer(query.query.rows(params).take(MAX_ROWS), now)
        if (query.cacheMillis > 0) {
            // Parameters are the editor's: past the bound, the oldest answers go first.
            if (cache.size >= MAX_CACHED) cache.entries.sortedBy { it.value.computedAt }.take(MAX_CACHED / 4).forEach { cache.remove(it.key) }
            cache[key] = answer
        }
        return answer
    }

    companion object {
        const val MAX_CACHE_SECONDS = 3600
        const val MAX_CACHED = 200
        const val MAX_ROWS = 2_000
    }
}
