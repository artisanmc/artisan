package net.artisanmc.plugin.customitems

import com.fasterxml.jackson.databind.JsonNode
import java.awt.image.BufferedImage
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * Draws a block model (`elements`) the way the game draws an item in an inventory slot: each
 * element's faces textured by their `uv`, the element's `rotation` about its origin, the model's
 * `display.gui` (scale, then rotation X Y Z, then translation), seen straight on, 16 model units
 * across the slot. No GPU and no window: a depth buffer over a plain image, so a server draws it.
 *
 * Drawn [SUPERSAMPLE] times larger than asked, then averaged down: edges come out smooth.
 */
internal object ModelPainter {
    private const val SUPERSAMPLE = 3

    /** The game's own shade of a face in an inventory lit from the side. */
    private val SHADE = mapOf("up" to 1.0, "down" to 0.5, "north" to 0.8, "south" to 0.8, "east" to 0.6, "west" to 0.6)
    private val FACES = listOf("down", "up", "north", "south", "west", "east")

    /** A block in an inventory, when the model sets no `display.gui`. */
    private val BLOCK_ROTATION = doubleArrayOf(30.0, 225.0, 0.0)
    private const val BLOCK_SCALE = 0.625

    private class Vec(val x: Double, val y: Double, val z: Double) {
        operator fun minus(o: Vec) = Vec(x - o.x, y - o.y, z - o.z)
        operator fun plus(o: Vec) = Vec(x + o.x, y + o.y, z + o.z)
    }

    /**
     * [elements] as an image [size] pixels a side, or null when nothing of it is visible.
     * [textures]: the image of each texture variable (`0`, `all`…) the faces name with `#`.
     */
    fun paint(elements: JsonNode, textures: Map<String, BufferedImage>, display: JsonNode?, guiLight: String?, size: Int): BufferedImage? {
        val side = size * SUPERSAMPLE
        val color = IntArray(side * side)
        val depth = DoubleArray(side * side) { Double.NEGATIVE_INFINITY }
        val scale = triple(display?.get("scale"), BLOCK_SCALE.takeIf { display == null } ?: 1.0).map { min(4.0, it) }
        val rotation = triple(display?.get("rotation"), 0.0).let { if (display == null) BLOCK_ROTATION.toList() else it }
        val translation = triple(display?.get("translation"), 0.0).map { it.coerceIn(-80.0, 80.0) }
        val (rx, ry, rz) = rotation.map { Math.toRadians(it) }

        // Model space (0 to 16) to the slot: centred, display transform, then 16 units across the image.
        fun place(p: Vec): Vec {
            var v = Vec((p.x - 8) * scale[0], (p.y - 8) * scale[1], (p.z - 8) * scale[2])
            v = rotate(rotate(rotate(v, 'z', rz), 'y', ry), 'x', rx)
            return Vec((v.x + translation[0] + 8) / 16 * side, (8 - v.y - translation[1]) / 16 * side, v.z + translation[2])
        }

        var drawn = false
        for (element in elements) {
            val from = triple(element.get("from"), 0.0)
            val to = triple(element.get("to"), 0.0)
            val faces = element.get("faces")?.takeIf { it.isObject } ?: continue
            val turn = turnOf(element.get("rotation"))
            val shaded = guiLight != "front" && element.get("shade")?.asBoolean(true) != false
            for (face in FACES) {
                val data = faces.get(face)?.takeIf { it.isObject } ?: continue
                val texture = textures[data.path("texture").asText("").removePrefix("#")] ?: continue
                val corners = corners(face, from, to).map { place(turn(it)) }
                val uv = data.get("uv")?.takeIf { it.isArray && it.size() == 4 }?.map { it.asDouble() } ?: defaultUv(face, from, to)
                val steps = ((data.path("rotation").asInt(0) / 90) % 4 + 4) % 4
                // Top-left, top-right, bottom-right, bottom-left of the texture area, turned clockwise by `rotation`.
                val area = listOf(uv[0] to uv[1], uv[2] to uv[1], uv[2] to uv[3], uv[0] to uv[3])
                val at = { i: Int -> area[((i - steps) % 4 + 4) % 4] }
                if (fill(color, depth, side, corners, at(0), at(1), at(3), texture, if (shaded) SHADE.getValue(face) else 1.0)) drawn = true
            }
        }
        return if (drawn) shrink(color, side, size) else null
    }

    /**
     * One face: the parallelogram of [corners] (top-left, top-right, bottom-right, bottom-left),
     * each pixel inside it taking the nearest texel, kept when nearer than what is already there.
     */
    private fun fill(
        color: IntArray, depth: DoubleArray, side: Int, corners: List<Vec>,
        uv0: Pair<Double, Double>, uv1: Pair<Double, Double>, uv3: Pair<Double, Double>,
        texture: BufferedImage, shade: Double,
    ): Boolean {
        val origin = corners[0]
        val a = corners[1] - origin
        val b = corners[3] - origin
        val det = a.x * b.y - a.y * b.x
        // Seen edge-on: nothing to draw.
        if (abs(det) < 1e-9) return false
        val xs = corners.map { it.x }
        val ys = corners.map { it.y }
        val x0 = max(0, floor(xs.min()).toInt())
        val x1 = min(side - 1, ceil(xs.max()).toInt())
        val y0 = max(0, floor(ys.min()).toInt())
        val y1 = min(side - 1, ceil(ys.max()).toInt())
        var drawn = false
        for (y in y0..y1) for (x in x0..x1) {
            val px = x + 0.5 - origin.x
            val py = y + 0.5 - origin.y
            val s = (px * b.y - py * b.x) / det
            val t = (a.x * py - a.y * px) / det
            if (s < 0 || s > 1 || t < 0 || t > 1) continue
            val z = origin.z + s * a.z + t * b.z
            val index = y * side + x
            if (z <= depth[index]) continue
            val u = uv0.first + s * (uv1.first - uv0.first) + t * (uv3.first - uv0.first)
            val v = uv0.second + s * (uv1.second - uv0.second) + t * (uv3.second - uv0.second)
            val texel = texture.getRGB(
                floor(u / 16 * texture.width).toInt().coerceIn(0, texture.width - 1),
                floor(v / 16 * texture.height).toInt().coerceIn(0, texture.height - 1),
            )
            val alpha = texel ushr 24
            if (alpha < 3) continue
            val lit = shade(texel, shade)
            color[index] = if (alpha == 255) lit else over(lit, color[index])
            depth[index] = z
            drawn = true
        }
        return drawn
    }

    private fun shade(argb: Int, shade: Double): Int {
        if (shade == 1.0) return argb
        fun channel(shift: Int) = (((argb ushr shift) and 0xff) * shade).toInt() shl shift
        return (argb and 0xff000000.toInt()) or channel(16) or channel(8) or channel(0)
    }

    /** [top] drawn over [under], both ARGB with straight alpha. */
    private fun over(top: Int, under: Int): Int {
        val ta = (top ushr 24) / 255.0
        val ua = (under ushr 24) / 255.0 * (1 - ta)
        val alpha = ta + ua
        if (alpha <= 0) return 0
        fun channel(shift: Int) = ((((top ushr shift) and 0xff) * ta + ((under ushr shift) and 0xff) * ua) / alpha).toInt().coerceIn(0, 255) shl shift
        return ((alpha * 255).toInt().coerceIn(0, 255) shl 24) or channel(16) or channel(8) or channel(0)
    }

    /** [SUPERSAMPLE] × [SUPERSAMPLE] pixels averaged into one, colours weighted by their alpha. */
    private fun shrink(color: IntArray, side: Int, size: Int): BufferedImage {
        val out = BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB)
        val samples = SUPERSAMPLE * SUPERSAMPLE
        for (y in 0 until size) for (x in 0 until size) {
            var a = 0; var r = 0; var g = 0; var b = 0
            for (dy in 0 until SUPERSAMPLE) for (dx in 0 until SUPERSAMPLE) {
                val argb = color[(y * SUPERSAMPLE + dy) * side + x * SUPERSAMPLE + dx]
                val alpha = argb ushr 24
                a += alpha
                r += ((argb ushr 16) and 0xff) * alpha
                g += ((argb ushr 8) and 0xff) * alpha
                b += (argb and 0xff) * alpha
            }
            if (a > 0) out.setRGB(x, y, ((a / samples) shl 24) or ((r / a) shl 16) or ((g / a) shl 8) or (b / a))
        }
        return out
    }

    /** The four corners of a face seen from outside: top-left, top-right, bottom-right, bottom-left. */
    private fun corners(face: String, from: List<Double>, to: List<Double>): List<Vec> {
        val (fx, fy, fz) = from
        val (tx, ty, tz) = to
        return when (face) {
            "down" -> listOf(Vec(fx, fy, tz), Vec(tx, fy, tz), Vec(tx, fy, fz), Vec(fx, fy, fz))
            "up" -> listOf(Vec(fx, ty, fz), Vec(tx, ty, fz), Vec(tx, ty, tz), Vec(fx, ty, tz))
            "north" -> listOf(Vec(tx, ty, fz), Vec(fx, ty, fz), Vec(fx, fy, fz), Vec(tx, fy, fz))
            "south" -> listOf(Vec(fx, ty, tz), Vec(tx, ty, tz), Vec(tx, fy, tz), Vec(fx, fy, tz))
            "west" -> listOf(Vec(fx, ty, fz), Vec(fx, ty, tz), Vec(fx, fy, tz), Vec(fx, fy, fz))
            else -> listOf(Vec(tx, ty, tz), Vec(tx, ty, fz), Vec(tx, fy, fz), Vec(tx, fy, tz))
        }
    }

    /** The texture area of a face that names none: the element's own position on the block. */
    private fun defaultUv(face: String, from: List<Double>, to: List<Double>): List<Double> {
        val (fx, fy, fz) = from
        val (tx, ty, tz) = to
        return when (face) {
            "down" -> listOf(fx, 16 - tz, tx, 16 - fz)
            "up" -> listOf(fx, fz, tx, tz)
            "north" -> listOf(16 - tx, 16 - ty, 16 - fx, 16 - fy)
            "south" -> listOf(fx, 16 - ty, tx, 16 - fy)
            "west" -> listOf(fz, 16 - ty, tz, 16 - fy)
            else -> listOf(16 - tz, 16 - ty, 16 - fz, 16 - fy)
        }
    }

    /**
     * An element's `rotation` as a move of its points: about `origin`, on one `axis` by `angle`
     * (the format up to 1.21.10) or on `x`, `y` and `z` at once (1.21.11), with `rescale`
     * stretching the two other axes so a turned face still spans the block.
     */
    private fun turnOf(rotation: JsonNode?): (Vec) -> Vec {
        if (rotation == null || !rotation.isObject) return { it }
        val origin = triple(rotation.get("origin"), 8.0).let { Vec(it[0], it[1], it[2]) }
        val axis = rotation.path("axis").asText("")
        val turns: List<Pair<Char, Double>> = if (axis.length == 1 && axis[0] in "xyz") {
            listOf(axis[0] to Math.toRadians(rotation.path("angle").asDouble(0.0)))
        } else {
            // Applied z, then y, then x, like the display transform.
            "zyx".map { it to Math.toRadians(rotation.path(it.toString()).asDouble(0.0)) }.filter { it.second != 0.0 }
        }
        if (turns.isEmpty()) return { it }
        val stretch = turns.singleOrNull()?.takeIf { rotation.path("rescale").asBoolean(false) }
            ?.let { (on, angle) -> (1 / cos(abs(angle))).takeIf { it.isFinite() }?.let { on to it } }
        return { p ->
            var v = p - origin
            stretch?.let { (on, factor) ->
                v = Vec(if (on == 'x') v.x else v.x * factor, if (on == 'y') v.y else v.y * factor, if (on == 'z') v.z else v.z * factor)
            }
            for ((on, angle) in turns) v = rotate(v, on, angle)
            v + origin
        }
    }

    private fun rotate(v: Vec, axis: Char, angle: Double): Vec {
        if (angle == 0.0) return v
        val c = cos(angle)
        val s = sin(angle)
        return when (axis) {
            'x' -> Vec(v.x, v.y * c - v.z * s, v.y * s + v.z * c)
            'y' -> Vec(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
            else -> Vec(v.x * c - v.y * s, v.x * s + v.y * c, v.z)
        }
    }

    private fun triple(node: JsonNode?, fallback: Double): List<Double> =
        List(3) { i -> node?.takeIf { it.isArray }?.get(i)?.takeIf { it.isNumber }?.asDouble() ?: fallback }
}
