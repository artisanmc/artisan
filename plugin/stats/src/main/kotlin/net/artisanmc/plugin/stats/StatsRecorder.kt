package net.artisanmc.plugin.stats

import net.artisanmc.modules.api.stats.PlayerMetric
import net.artisanmc.modules.api.stats.StatEvent
import net.artisanmc.modules.api.stats.StatQuery
import net.artisanmc.modules.api.stats.StatScope
import net.artisanmc.modules.api.stats.StatStorage
import net.artisanmc.modules.api.stats.StatsApi
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** The `stats` section of `config.yml` the recorder reads at each record. */
data class StatsSettings(
    val enabled: Boolean = true,
    /** Events turned off one by one (`stats.disabled-events`). */
    val disabledEvents: Set<String> = emptySet(),
)

/**
 * `api.getStats()` (ADR `stats-foundation` ②③④): the catalogue of declared Stat events and the
 * checks of a record, in front of a [StatsBuffer]. A wrong record is dropped with one warning per
 * event, never thrown into the caller's code.
 */
class StatsRecorder(
    private val clock: () -> Long = System::currentTimeMillis,
    private val warn: (String) -> Unit,
    private val settings: () -> StatsSettings = { StatsSettings() },
    maxRaw: Int = StatsBuffer.DEFAULT_MAX_RAW,
) : StatsApi {
    private class Declared(val event: StatEvent, val openDimensions: Boolean)

    val buffer = StatsBuffer(maxRaw)
    private val catalog = ConcurrentHashMap<String, Declared>()
    /** Distinct values seen per `event|dimension` in this run, up to [MAX_VALUES]. */
    private val seen = ConcurrentHashMap<String, MutableSet<String>>()
    private val warned = ConcurrentHashMap.newKeySet<String>()

    override fun declare(event: StatEvent) {
        require(event.namespace !in RESERVED) { "Stat event ${event.name}: the namespaces ${RESERVED.joinToString()} are Artisan's" }
        put(event, openDimensions = false)
    }

    /** Artisan's own `core:*` events. */
    fun declareCore(event: StatEvent) = put(event, openDimensions = false)

    private fun put(event: StatEvent, openDimensions: Boolean) {
        val previous = catalog.putIfAbsent(event.name, Declared(event, openDimensions)) ?: return
        require(previous.event == event) { "Stat event ${event.name} is already declared as ${previous.event}" }
    }

    override fun isDeclared(name: String) = catalog.containsKey(name)

    /** The figures modules compute on demand. */
    val queries = StatQueries(clock)

    override fun declareQuery(id: String, cacheSeconds: Int, query: StatQuery) {
        require(StatEvent.NAME.matcher(id).matches()) { "Stat query '$id': expected <namespace>:<name>, lower case" }
        require(id.substringBefore(':') !in RESERVED) { "Stat query $id: the namespaces ${RESERVED.joinToString()} are Artisan's" }
        queries.declare(id, cacheSeconds, query)
    }

    /** Metric values waiting for the database (ADR `stats-export`). */
    val metricBuffer = MetricBuffer()
    private val metrics = ConcurrentHashMap<String, PlayerMetric>()

    override fun declareMetric(metric: PlayerMetric) {
        require(metric.namespace !in RESERVED) { "Metric ${metric.id}: the namespaces ${RESERVED.joinToString()} are Artisan's" }
        putMetric(metric)
    }

    /** Artisan's own `core:*` metrics. */
    fun declareCoreMetric(metric: PlayerMetric) = putMetric(metric)

    private fun putMetric(metric: PlayerMetric) {
        val previous = metrics.putIfAbsent(metric.id, metric) ?: return
        require(previous == metric) { "Metric ${metric.id} is already declared as $previous" }
    }

    override fun setMetric(metric: String, player: UUID, value: Long) {
        if (!settings().enabled) return
        if (!metrics.containsKey(metric)) return warnOnce("metric|$metric", "Metric $metric is not declared: its values are dropped")
        metricBuffer.set(metric, player.toString(), value)
    }

    /** The declared metrics, by id. */
    fun declaredMetrics(): List<PlayerMetric> = metrics.values.sortedBy { it.id }

    override fun isEnabled() = settings().enabled

    /** The declared events, by name. */
    fun declared(): List<StatEvent> = catalog.values.map { it.event }.sortedBy { it.name }

    /** Events with their own raw retention, in days. */
    fun rawRetentions(): Map<String, Int> =
        catalog.values.filter { it.event.rawRetentionDays > 0 }.associate { it.event.name to it.event.rawRetentionDays }

    override fun record(event: String, player: UUID?, dimensions: Map<String, String>, value: Double, details: Map<String, String>) {
        val settings = settings()
        if (!settings.enabled || event in settings.disabledEvents) return
        val declared = catalog[event] ?: return warnOnce(event, "Stat event $event is not declared: its records are dropped")
        add(declared, player, dimensions, value, details)
    }

    /**
     * The `record_event` action: `custom:<name>`, declared on its first record (both storages,
     * player counter), with whatever dimensions each record names.
     */
    fun recordCustom(name: String, player: UUID?, dimensions: Map<String, String>, value: Double, details: Map<String, String> = emptyMap()) {
        val settings = settings()
        val event = "$CUSTOM:$name"
        if (!settings.enabled || event in settings.disabledEvents) return
        if (!StatEvent.NAME.matcher(event).matches()) return warnOnce(event, "record_event \"$name\": lower case, digits, _ and . only")
        val declared = catalog.computeIfAbsent(event) {
            Declared(StatEvent.builder(event).storage(StatStorage.BOTH).build(), openDimensions = true)
        }
        add(declared, player, dimensions, value, details)
    }

    private fun add(declared: Declared, player: UUID?, dimensions: Map<String, String>, value: Double, details: Map<String, String>) {
        val event = declared.event
        val name = event.name
        when {
            event.scope == StatScope.PLAYER && player == null -> return warnOnce(name, "Stat event $name is about a player: a record without one is dropped")
            event.scope == StatScope.SERVER && player != null -> return warnOnce(name, "Stat event $name is about the server: a record with a player is dropped")
            !value.isFinite() -> return warnOnce(name, "Stat event $name: the value $value is dropped")
        }
        val keys = if (declared.openDimensions) {
            val bad = dimensions.keys.firstOrNull { !StatEvent.FIELD.matcher(it).matches() }
            if (bad != null || dimensions.size > StatEvent.MAX_DIMENSIONS) {
                return warnOnce(name, "Stat event $name: dimension names are lower case, digits and _, ${StatEvent.MAX_DIMENSIONS} at most")
            }
            dimensions.keys
        } else {
            val unknown = dimensions.keys - event.dimensions.toSet()
            if (unknown.isNotEmpty()) return warnOnce(name, "Stat event $name has no dimension ${unknown.joinToString()}: the record is dropped")
            event.dimensions
        }
        val dims = Dimensions.encode(keys.associateWith { bounded(name, it, dimensions[it].orEmpty()) })
        val now = clock()
        val who = player?.toString().orEmpty()
        if (event.storage.bucketed()) {
            val hour = Math.floorDiv(now, HOUR_MS) * HOUR_SECONDS
            buffer.addBucket(BucketRow(who, name, dims, hour, Granularity.HOUR, 1, value, value, value))
        }
        if (event.storage.raw()) buffer.addRaw(RawRow(who, name, now, dims, value, Dimensions.json(details)))
    }

    /** [value] cut to [MAX_LENGTH]; past [MAX_VALUES] distinct values of a dimension, [OTHER]. */
    private fun bounded(event: String, dimension: String, value: String): String {
        val cut = value.take(MAX_LENGTH)
        val values = seen.computeIfAbsent("$event|$dimension") { ConcurrentHashMap.newKeySet() }
        if (cut in values) return cut
        synchronized(values) {
            if (values.size < MAX_VALUES) {
                values.add(cut)
                return cut
            }
        }
        warnOnce("$event|$dimension", "Stat event $event: more than $MAX_VALUES values of $dimension, the next ones are counted as \"$OTHER\"")
        return OTHER
    }

    private fun warnOnce(key: String, message: String) {
        if (warned.add(key)) warn(message)
    }

    companion object {
        const val CORE = "core"
        const val CUSTOM = "custom"
        val RESERVED = setOf(CORE, CUSTOM)
        const val MAX_VALUES = 200
        const val MAX_LENGTH = 64
        const val OTHER = "other"
        private const val HOUR_SECONDS = 3600L
        private const val HOUR_MS = HOUR_SECONDS * 1000
    }
}

/** Drains the buffer into [writer]; a failed write puts it back and rethrows. The number of rows handed over. */
fun StatsRecorder.flushTo(writer: StatsWriter): Int {
    val batch = buffer.drain()
    if (batch.isEmpty()) return 0
    try {
        writer.write(batch)
    } catch (e: Exception) {
        buffer.restore(batch)
        throw e
    }
    return batch.buckets.size + batch.raws.size
}

/** Drains the metric values into [writer] at [now]; a failed write puts them back and rethrows. The number of values handed over. */
fun StatsRecorder.flushMetricsTo(writer: MetricWriter, now: Long = System.currentTimeMillis()): Int {
    val batch = metricBuffer.drain()
    if (batch.isEmpty()) return 0
    try {
        writer.write(batch, now)
    } catch (e: Exception) {
        metricBuffer.restore(batch)
        throw e
    }
    return batch.size
}
