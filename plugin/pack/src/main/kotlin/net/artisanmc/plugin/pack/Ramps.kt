package net.artisanmc.plugin.pack

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.math.max
import kotlin.math.min

/**
 * The base's colour ramps (ADR `common-images-and-themes`, decision 7), the editor's
 * `lib/pack/ramps.ts`: each colour of the base's images belongs to one ramp, with the ramp's
 * main colour, the one a button's face has. A theme changes a ramp by picking the colour its
 * main one becomes; [table] computes what each shade becomes, and the theme's file keeps that
 * exact colour-to-colour table. The pack builders apply the table and never compute a colour.
 *
 * `kit/ramps.json` is the declaration, the same file the editor reads. [shade] gives the same
 * colours as the editor's `rampShade`, checked on both sides against `testdata/ramp-shades-conformance.json`.
 */
object Ramps {
    /** One ramp: its [id], its [main] colour and every one of its [shades], each as `0xRRGGBB`. */
    class Ramp(val id: String, val main: Int, val shades: List<Int>)

    val all: List<Ramp> by lazy {
        val declared = Ramps::class.java.getResourceAsStream("kit/ramps.json")?.use { ObjectMapper().readTree(it) }
            ?: error("kit file ramps.json missing from the jar")
        declared.map { ramp -> Ramp(ramp["id"].asText(), color(ramp["main"].asText()), ramp["shades"].map { color(it.asText()) }) }
    }

    fun ramp(id: String): Ramp? = all.firstOrNull { it.id == id }

    private fun color(text: String) = text.substring(1).toInt(16)

    /** Hue in turns, saturation and lightness in 0..1. */
    private class Hsl(val h: Double, val s: Double, val l: Double)

    private fun toHsl(color: Int): Hsl {
        val r = ((color shr 16) and 255) / 255.0
        val g = ((color shr 8) and 255) / 255.0
        val b = (color and 255) / 255.0
        val max = max(r, max(g, b))
        val min = min(r, min(g, b))
        val l = (max + min) / 2
        if (max == min) return Hsl(0.0, 0.0, l)
        val d = max - min
        val s = if (l > 0.5) d / (2 - max - min) else d / (max + min)
        val h = when (max) {
            r -> ((g - b) / d + (if (g < b) 6 else 0)) / 6
            g -> ((b - r) / d + 2) / 6
            else -> ((r - g) / d + 4) / 6
        }
        return Hsl(h, s, l)
    }

    private fun fromHsl(h: Double, s: Double, l: Double): Int {
        fun channel(t: Double): Int {
            val k = (t + 1) % 1
            val q = if (l < 0.5) l * (1 + s) else l + s - l * s
            val p = 2 * l - q
            val v = when {
                k < 1.0 / 6 -> p + (q - p) * 6 * k
                k < 1.0 / 2 -> q
                k < 2.0 / 3 -> p + (q - p) * (2.0 / 3 - k) * 6
                else -> p
            }
            return max(0, min(255, Math.round(v * 255).toInt()))
        }
        return (channel(h + 1.0 / 3) shl 16) or (channel(h) shl 8) or channel(h - 1.0 / 3)
    }

    private fun clamp(value: Double) = max(0.0, min(1.0, value))

    /**
     * What the shade [shade] of [ramp] becomes when the ramp's main colour becomes [picked]: the
     * picked colour's hue, the shade's saturation in the proportion it had to the main colour's
     * (the picked one's for a ramp of greys), and its lightness kept in the place it had between
     * black, the main colour and white. So the main colour becomes [picked] exactly, black stays
     * black, white stays white, and two shades keep their order.
     */
    fun shade(ramp: Ramp, shade: Int, picked: Int): Int {
        if (shade == ramp.main) return picked
        val main = toHsl(ramp.main)
        val from = toHsl(shade)
        val to = toHsl(picked)
        val l = if (from.l <= main.l) {
            if (main.l == 0.0) 0.0 else (from.l * to.l) / main.l
        } else {
            if (main.l == 1.0) 1.0 else 1 - ((1 - from.l) * (1 - to.l)) / (1 - main.l)
        }
        val s = if (main.s == 0.0) to.s else clamp((to.s * from.s) / main.s)
        return fromHsl(to.h, s, clamp(l))
    }

    /**
     * The table of a theme that turns the main colour of [ramp] into [picked]: each shade to what
     * it becomes, in the ramp's order, the ones that do not change left out.
     */
    fun table(ramp: Ramp, picked: Int): Map<Int, Int> {
        val out = LinkedHashMap<Int, Int>()
        if (picked == ramp.main) return out
        for (shade in ramp.shades) shade(ramp, shade, picked).takeIf { it != shade }?.let { out[shade] = it }
        return out
    }
}
