package net.artisanmc.plugin.scene

import net.artisanmc.modules.api.scene.SceneElement
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * Which [SceneElement.Hitbox] a ray hits (`ScenesApi.aimed`): pure geometry, no Bukkit. A hitbox
 * stands at its anchor + its transform's offset, a vertical rectangle turned by its yaw the way
 * `EntityDisplayBackend.transformation` turns a display: its width runs along (cos yaw, 0, sin yaw).
 */
object ScenePick {

    data class Vec(val x: Double, val y: Double, val z: Double)

    /** The key of the nearest hitbox the ray [eye] + t·[dir] (t in 0..[range], [dir] normalised) hits, or null. */
    fun aimed(base: Vec, hitboxes: List<SceneElement.Hitbox>, eye: Vec, dir: Vec, range: Double): String? {
        var best: String? = null
        var bestT = Double.MAX_VALUE
        for (h in hitboxes) {
            val t = hit(base, h, eye, dir) ?: continue
            if (t <= range && t < bestT) {
                best = h.key()
                bestT = t
            }
        }
        return best
    }

    /** How far along the ray it hits [h], or null. */
    internal fun hit(base: Vec, h: SceneElement.Hitbox, eye: Vec, dir: Vec): Double? {
        val tr = h.transform()
        val cx = base.x + tr.x()
        val cy = base.y + tr.y()
        val cz = base.z + tr.z()
        val yaw = Math.toRadians(tr.yaw().toDouble())
        val ux = cos(yaw)
        val uz = sin(yaw)
        // The plane's normal: horizontal, across the width.
        val nx = -uz
        val nz = ux
        val facing = dir.x * nx + dir.z * nz
        if (abs(facing) < EPSILON) return null
        val t = ((cx - eye.x) * nx + (cz - eye.z) * nz) / facing
        if (t < 0) return null
        val px = eye.x + dir.x * t
        val py = eye.y + dir.y * t
        val pz = eye.z + dir.z * t
        val across = (px - cx) * ux + (pz - cz) * uz
        val up = py - cy
        val scale = tr.scale().toDouble()
        return if (abs(across) <= h.width() * scale / 2 && up >= 0 && up <= h.height() * scale) t else null
    }

    private const val EPSILON = 1e-9
}
