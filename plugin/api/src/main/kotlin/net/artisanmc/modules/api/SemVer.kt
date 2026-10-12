package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Stable

/** Minimal SemVer compare for module↔core compatibility (same major; core >= min). */
@Stable
object SemVer {
    private fun parse(v: String): Triple<Int, Int, Int> {
        val p = v.substringBefore("-").split(".").map { it.toIntOrNull() ?: 0 }
        return Triple(p.getOrElse(0) { 0 }, p.getOrElse(1) { 0 }, p.getOrElse(2) { 0 })
    }

    /** True if [core] is the same major as [min] and >= it. */
    @Stable
    fun satisfies(core: String, min: String): Boolean {
        val c = parse(core)
        val m = parse(min)
        if (c.first != m.first) return false
        if (c.second != m.second) return c.second > m.second
        return c.third >= m.third
    }
}
