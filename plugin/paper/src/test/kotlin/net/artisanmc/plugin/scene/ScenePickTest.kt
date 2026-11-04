package net.artisanmc.plugin.scene

import net.artisanmc.modules.api.scene.SceneElement
import net.artisanmc.modules.api.scene.SceneTransform
import net.artisanmc.plugin.scene.ScenePick.Vec
import kotlin.math.sqrt
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ScenePickTest {

    private val base = Vec(0.0, 64.0, 0.0)
    private val eye = Vec(0.0, 64.5, -3.0)
    private val south = Vec(0.0, 0.0, 1.0)

    /** Two choices, one above the other, across x (yaw 0), 3 blocks south of the eyes. */
    private val upper = SceneElement.Hitbox("upper", SceneTransform.offset(0.0, 0.6, 0.0), 2.0, 0.3)
    private val lower = SceneElement.Hitbox("lower", SceneTransform.offset(0.0, 0.2, 0.0), 2.0, 0.3)

    private fun toward(x: Double, y: Double, z: Double): Vec {
        val dx = x - eye.x
        val dy = y - eye.y
        val dz = z - eye.z
        val n = sqrt(dx * dx + dy * dy + dz * dz)
        return Vec(dx / n, dy / n, dz / n)
    }

    @Test
    fun `the crosshair picks the hitbox it is on`() {
        assertEquals("upper", ScenePick.aimed(base, listOf(upper, lower), eye, toward(0.5, 64.75, 0.0), 8.0))
        assertEquals("lower", ScenePick.aimed(base, listOf(upper, lower), eye, toward(-0.9, 64.3, 0.0), 8.0))
        // Between the two, beside them, behind the eyes, out of range.
        assertNull(ScenePick.aimed(base, listOf(upper, lower), eye, toward(0.0, 64.55, 0.0), 8.0))
        assertNull(ScenePick.aimed(base, listOf(upper, lower), eye, toward(1.2, 64.3, 0.0), 8.0))
        assertNull(ScenePick.aimed(base, listOf(upper, lower), eye, Vec(0.0, 0.0, -1.0), 8.0))
        assertNull(ScenePick.aimed(base, listOf(upper, lower), eye, south, 2.0))
    }

    @Test
    fun `a hitbox turns with its yaw, and scales`() {
        // Yaw 90: the width runs along z, the plane faces x.
        val side = SceneElement.Hitbox("side", SceneTransform(0.0, 0.0, 0.0, 90f, 1f), 2.0, 1.0)
        val fromWest = Vec(-3.0, 64.5, 0.0)
        assertEquals("side", ScenePick.aimed(base, listOf(side), fromWest, Vec(1.0, 0.0, 0.0), 8.0))
        assertNull(ScenePick.aimed(base, listOf(side), eye, south, 8.0))
        val big = SceneElement.Hitbox("big", SceneTransform.offset(0.0, 0.0, 0.0).withScale(2f), 1.0, 0.5)
        assertEquals("big", ScenePick.aimed(base, listOf(big), eye, toward(0.9, 64.9, 0.0), 8.0))
    }

    @Test
    fun `the nearest of two hitboxes in line wins`() {
        val near = SceneElement.Hitbox("near", SceneTransform.offset(0.0, 0.0, -1.0), 1.0, 1.0)
        val far = SceneElement.Hitbox("far", SceneTransform.ORIGIN, 1.0, 1.0)
        assertEquals("near", ScenePick.aimed(base, listOf(far, near), eye, south, 8.0))
    }
}
