package net.artisanmc.plugin.engine

/**
 * A place in a world, the value of the `location` type (ADR `triggers-and-variables` §4): what
 * `{event.location}` holds, what a `location` Variable stores, what `teleport` reads. A map
 * (`{world, x, y, z, yaw, pitch}`) so expressions read `{event.location.x}`; its text is
 * `world x y z`, so `{event.location}` in a message reads as a place, not as a map.
 */
class LocationValue(
    val world: String,
    val x: Double,
    val y: Double,
    val z: Double,
    val yaw: Double = 0.0,
    val pitch: Double = 0.0,
) : AbstractMap<String, Any?>() {
    override val entries: Set<Map.Entry<String, Any?>>
        get() = toWire().entries

    /** The stored and wire form: `{world, x, y, z, yaw, pitch}`. */
    fun toWire(): Map<String, Any?> = linkedMapOf(
        "world" to world, "x" to x, "y" to y, "z" to z, "yaw" to yaw, "pitch" to pitch,
    )

    override fun toString(): String = "$world ${num(x)} ${num(y)} ${num(z)}"

    companion object {
        private fun num(d: Double): String = if (d == Math.floor(d) && !d.isInfinite()) d.toLong().toString() else d.toString()

        private val SEPARATORS = Regex("[\\s,]+")

        /**
         * [value] as a place, or null when it is not one: a map with a `world` and numeric (or
         * numeric text) `x`, `y`, `z`, optional `yaw`, `pitch`; or a text `world x y z [yaw pitch]`
         * (spaces or commas), which is also what a [LocationValue] renders to.
         */
        fun from(value: Any?): LocationValue? = when (value) {
            null -> null
            is LocationValue -> value
            is Map<*, *> -> {
                val world = value["world"]?.toString()?.trim()?.takeIf { it.isNotEmpty() }
                val x = number(value["x"])
                val y = number(value["y"])
                val z = number(value["z"])
                if (world == null || x == null || y == null || z == null) null
                else {
                    val yaw = value["yaw"]?.let(::number)
                    val pitch = value["pitch"]?.let(::number)
                    if ((value["yaw"] != null && yaw == null) || (value["pitch"] != null && pitch == null)) null
                    else LocationValue(world, x, y, z, yaw ?: 0.0, pitch ?: 0.0)
                }
            }
            is String -> parse(value)
            else -> null
        }

        private fun parse(text: String): LocationValue? {
            val parts = text.trim().split(SEPARATORS).filter { it.isNotEmpty() }
            if (parts.size != 4 && parts.size != 6) return null
            val n = parts.drop(1).map { it.toDoubleOrNull() ?: return null }
            return LocationValue(parts[0], n[0], n[1], n[2], n.getOrElse(3) { 0.0 }, n.getOrElse(4) { 0.0 })
        }

        private fun number(v: Any?): Double? = when (v) {
            is Number -> v.toDouble()
            is String -> v.trim().toDoubleOrNull()
            else -> null
        }?.takeIf { it.isFinite() }
    }
}
