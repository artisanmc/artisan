package net.artisanmc.plugin.pack

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.round
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/** A rectangle of an image, in its own pixels. */
data class PixelRect(val x: Int, val y: Int, val width: Int, val height: Int) {
    val right: Int get() = x + width
    val bottom: Int get() = y + height

    /** The part of it [image] has; null when none. */
    fun within(image: RgbaImage): PixelRect? {
        val x0 = x.coerceAtLeast(0)
        val y0 = y.coerceAtLeast(0)
        val x1 = right.coerceAtMost(image.width)
        val y1 = bottom.coerceAtMost(image.height)
        return if (x1 > x0 && y1 > y0) PixelRect(x0, y0, x1 - x0, y1 - y0) else null
    }

    fun grown(by: Int) = PixelRect(x - by, y - by, width + 2 * by, height + 2 * by)
}

/**
 * Pixel art taken out of a picture that only shows it: a screenshot at some GUI scale, a mock-up
 * (design `design-ia-menus-assets`, step 5). Finds how many of the picture's pixels make one pixel
 * of the art ([grid]), brings a rectangle back to one pixel each ([reduce]), removes the
 * background around an element ([cutOut], [trim]), keeps few colours ([limit], [settle]), and
 * tells the elements of a picture apart from its background ([elements]). Pure; a colour is
 * `0xRRGGBBAA`.
 */
object PixelArt {
    /** The largest art pixel [grid] looks for, in picture pixels. */
    const val MAX_CELL = 16
    /** Two neighbours this far apart (red, green, blue and alpha summed) are an edge of the art. */
    private const val EDGE = 40
    /** The share of the edges a grid must explain. */
    private const val GRID_SHARE = 0.85
    /** Half an edge: what an edge of the art is worth once a resize or a JPEG spread it over two pixels. */
    private const val SOFT_EDGE = 20
    /** The art's pixel in a picture resized by a fraction: below three picture pixels a cell has no inside left to read. */
    private const val MIN_FRACTION = 3.0
    private const val MAX_FRACTION = 32.0
    /** How well a fraction's cells must explain each axis (1: every change on a boundary; a turned or smooth picture stays under 0.3). */
    private const val FRACTION_FIT = 0.5
    /** The places an axis must change at for a fraction to be read off it. */
    private const val FRACTION_CHANGES = 8
    /** The share of the pixels between two cells' middles that may be neither of the two colours nor a mix of them. */
    private const val OTHER_SHARE = 0.25
    /** A fraction this close to a whole number (as a share of it) is that number. */
    private const val WHOLE_WITHIN = 0.004
    private const val MAX_ELEMENTS = 64
    private const val MASK_PIXELS = 1_000_000
    /** The share of a row or a column one colour must hold for it to be a line of a frame, and how many such lines side by side still are. */
    private const val LINE_SHARE = 0.5
    private const val LINE_WIDTH = 2

    fun rgba(image: RgbaImage, x: Int, y: Int): Int {
        val at = (y * image.width + x) * 4
        val d = image.data
        return ((d[at].toInt() and 0xff) shl 24) or ((d[at + 1].toInt() and 0xff) shl 16) or ((d[at + 2].toInt() and 0xff) shl 8) or (d[at + 3].toInt() and 0xff)
    }

    private fun put(image: RgbaImage, x: Int, y: Int, rgba: Int) {
        val at = (y * image.width + x) * 4
        image.data[at] = (rgba ushr 24).toByte()
        image.data[at + 1] = (rgba ushr 16).toByte()
        image.data[at + 2] = (rgba ushr 8).toByte()
        image.data[at + 3] = rgba.toByte()
    }

    /** Red, green, blue and alpha apart, summed; two transparent pixels are the same whatever their colour. */
    fun distance(a: Int, b: Int): Int {
        val alphaA = a and 0xff
        val alphaB = b and 0xff
        if (alphaA == 0 && alphaB == 0) return 0
        return abs((a ushr 24) - (b ushr 24)) + abs(((a ushr 16) and 0xff) - ((b ushr 16) and 0xff)) +
            abs(((a ushr 8) and 0xff) - ((b ushr 8) and 0xff)) + abs(alphaA - alphaB)
    }

    /**
     * One pixel of the art is [size] pixels of the picture, the cells starting at [offsetX],
     * [offsetY] (each below [size]). A whole [size] is exact; a fraction is a picture resized after
     * it was drawn (a store's preview, a mock-up), its cells found to a hundredth of a pixel.
     */
    class Grid(val size: Double, val offsetX: Double, val offsetY: Double) {
        constructor(size: Int, offsetX: Int, offsetY: Int) : this(size.toDouble(), offsetX.toDouble(), offsetY.toDouble())

        val whole: Boolean get() = size == round(size)
    }

    /** Whole cells of a grid: [columns] by [rows] cells of [size] picture pixels, from [x], [y]. */
    class Cells(val x: Double, val y: Double, val size: Double, val columns: Int, val rows: Int) {
        /** The picture's pixels [columns] by [rows] cells cover, from the cell [column], [row]. */
        fun rect(column: Int = 0, row: Int = 0, columns: Int = this.columns, rows: Int = this.rows): PixelRect {
            val x0 = (x + column * size).roundToInt()
            val y0 = (y + row * size).roundToInt()
            return PixelRect(x0, y0, (x + (column + columns) * size).roundToInt() - x0, (y + (row + rows) * size).roundToInt() - y0)
        }
    }

    /** The colour changes of a zone, summed along each column ([across]) and each row ([down]); `[i]` is the change between pixel `i - 1` and `i`. */
    private class Changes(val x: Int, val y: Int, val across: LongArray, val down: LongArray, val softAcross: DoubleArray, val softDown: DoubleArray)

    private fun changes(image: RgbaImage, area: PixelRect): Changes {
        val across = LongArray(area.width)
        val down = LongArray(area.height)
        val softAcross = DoubleArray(area.width)
        val softDown = DoubleArray(area.height)
        for (y in area.y until area.bottom) for (x in area.x until area.right) {
            val here = rgba(image, x, y)
            if (x > area.x) distance(here, rgba(image, x - 1, y)).let {
                if (it > EDGE) across[x - area.x] += it.toLong()
                if (it > SOFT_EDGE) softAcross[x - area.x] += it.toDouble()
            }
            if (y > area.y) distance(here, rgba(image, x, y - 1)).let {
                if (it > EDGE) down[y - area.y] += it.toLong()
                if (it > SOFT_EDGE) softDown[y - area.y] += it.toDouble()
            }
        }
        return Changes(area.x, area.y, across, down, softAcross, softDown)
    }

    /**
     * The grid [zone]'s edges fall on. First the exact one: the largest cell, from [MAX_CELL] down
     * to 2, whose boundaries hold [GRID_SHARE] of the colour changes, across and down. Else the
     * one of a picture resized by a fraction or smoothed ([fraction]). Null: the zone is not
     * enlarged pixel art (drawn at its own size, turned, a photograph), or too plain to tell.
     */
    fun grid(image: RgbaImage, zone: PixelRect): Grid? {
        val area = zone.within(image) ?: return null
        val changes = changes(image, area)
        for (size in MAX_CELL downTo 2) {
            val x = residue(changes.across, area.x, size) ?: continue
            val y = residue(changes.down, area.y, size) ?: continue
            return Grid(size, x, y)
        }
        return fraction(changes)?.takeIf { enlarged(image, area, it) }
    }

    /**
     * True when [area] is drawn in [grid]'s cells: between the middles of two neighbouring cells,
     * every pixel is one of the two colours or a mix of them (the soft edge a resize leaves).
     * Lines one pixel wide at an even pitch (an inventory at its own size, a table) fall on a
     * grid's boundaries too, but are a third colour between two cells: no pixel art enlarged.
     */
    private fun enlarged(image: RgbaImage, area: PixelRect, grid: Grid): Boolean {
        var mixed = 0L
        var other = 0L
        /** The pixels of one line of [area], from one cell's middle to the next. */
        fun line(length: Int, origin: Int, offset: Double, at: (Int) -> Int) {
            var middle = origin + (((offset - origin) % grid.size) + grid.size) % grid.size + grid.size / 2
            while (middle + grid.size < origin + length) {
                val from = floor(middle).toInt()
                val to = floor(middle + grid.size).toInt()
                val a = at(from)
                val b = at(to)
                for (i in from + 1 until to) {
                    val colour = at(i)
                    val toA = distance(colour, a)
                    val toB = distance(colour, b)
                    if (toA <= SOFT_EDGE || toB <= SOFT_EDGE) continue
                    val apart = distance(a, b)
                    if (toA + toB - apart <= EDGE + apart / 2) mixed++ else other++
                }
                middle += grid.size
            }
        }
        for (y in area.y until area.bottom) line(area.width, area.x, grid.offsetX) { rgba(image, it, y) }
        for (x in area.x until area.right) line(area.height, area.y, grid.offsetY) { rgba(image, x, it) }
        return other <= OTHER_SHARE * (mixed + other)
    }

    /**
     * [grid] of [zone], else of what surrounds it, else of the whole image: a plain element says
     * nothing of the art's pixel, the picture it stands in does. An element drawn in blocks of
     * several art pixels (a chequered block) reads as a larger pixel on its own: the picture's
     * pixel wins when the zone's is a whole number of them. A fraction found further away is laid
     * again on the zone's own edges ([laid]): a hundredth of a pixel adds up over a picture.
     */
    fun gridAround(image: RgbaImage, zone: PixelRect): Grid? {
        val own = grid(image, zone)
        val around = grid(image, zone.grown(maxOf(zone.width, zone.height))) ?: grid(image, PixelRect(0, 0, image.width, image.height))
        if (around == null) return own
        if (own != null) {
            val times = own.size / around.size
            if (times < 1.5 || abs(times - round(times)) > 0.03 * times) return own
        }
        return if (around.whole) around else laid(image, zone, around.size, around)
    }

    /** Where cells of [size] start (modulo [size]) when they explain the [changes] counted from [origin]; null when they do not. */
    private fun residue(changes: LongArray, origin: Int, size: Int): Int? {
        if (changes.count { it > 0 } < 3) return null
        val sums = LongArray(size)
        changes.forEachIndexed { i, change -> sums[(origin + i) % size] += change }
        val best = sums.indices.maxBy { sums[it] }
        return best.takeIf { sums[it] >= GRID_SHARE * sums.sum() }
    }

    /** How well cells of one size explain the changes of one axis: [strength] from 0 to 1, and where the cells start. */
    private class Fit(val strength: Double, val offset: Double)

    /**
     * [changes], counted from [origin], against cells of [size]: each change is a turn of
     * `position / size`, and they add up when they fall a whole number of cells apart.
     */
    private fun fit(origin: Int, changes: DoubleArray, size: Double): Fit {
        var re = 0.0
        var im = 0.0
        var total = 0.0
        val turn = 2 * PI / size
        for (i in changes.indices) {
            val weight = changes[i]
            if (weight == 0.0) continue
            re += weight * cos(turn * (origin + i))
            im += weight * sin(turn * (origin + i))
            total += weight
        }
        if (total == 0.0) return Fit(0.0, 0.0)
        val offset = atan2(im, re) / turn
        return Fit(sqrt(re * re + im * im) / total, ((offset % size) + size) % size)
    }

    /**
     * The grid of a picture resized by a fraction, or smoothed: the cell size, from
     * [MIN_FRACTION] to [MAX_FRACTION] picture pixels, whose boundaries the changes fall on best,
     * across and down at once, each axis by [FRACTION_FIT] at least. Close to a whole number, it
     * is that number (an exact enlargement a JPEG smoothed).
     */
    private fun fraction(changes: Changes): Grid? {
        val length = maxOf(changes.across.size, changes.down.size)
        val shortest = minOf(changes.across.size, changes.down.size)
        if (changes.softAcross.count { it > 0 } < FRACTION_CHANGES || changes.softDown.count { it > 0 } < FRACTION_CHANGES) return null
        val largest = minOf(MAX_FRACTION, shortest / 4.0)
        if (largest <= MIN_FRACTION) return null
        fun joint(size: Double): Double {
            val x = fit(changes.x, changes.softAcross, size).strength
            if (x < FRACTION_FIT) return 0.0
            val y = fit(changes.y, changes.softDown, size).strength
            return if (y < FRACTION_FIT) 0.0 else x * y
        }
        // Sizes a third of a turn apart over the zone's length: no peak falls between two of them.
        val step = 1.0 / (3 * length)
        var best = 0.0
        var bestFrequency = 0.0
        var frequency = 1 / largest
        while (frequency <= 1 / MIN_FRACTION) {
            val value = joint(1 / frequency)
            if (value > best) {
                best = value
                bestFrequency = frequency
            }
            frequency += step
        }
        if (best == 0.0) return null
        // Then to a thirtieth of that step.
        var size = 1 / bestFrequency
        for (i in -10..10) (1 / (bestFrequency + i * step / 10)).let { if (joint(it) > joint(size)) size = it }
        val whole = round(size)
        if (abs(size - whole) < WHOLE_WITHIN * size && joint(whole) > 0.0) size = whole
        return Grid(size, fit(changes.x, changes.softAcross, size).offset, fit(changes.y, changes.softDown, size).offset)
    }

    /**
     * Cells of [size] laid where [zone]'s own changes fall, two cells around it included; an axis
     * too plain to tell keeps [otherwise]'s cells, or starts at the zone's corner. For a size
     * read elsewhere in the picture, or given by hand.
     */
    fun laid(image: RgbaImage, zone: PixelRect, size: Double, otherwise: Grid? = null): Grid {
        val area = zone.grown(ceil(2 * size).toInt()).within(image) ?: return otherwise ?: Grid(size, 0.0, 0.0)
        val changes = changes(image, area)
        fun offset(origin: Int, soft: DoubleArray, fallback: Double): Double {
            if (soft.count { it > 0 } < 3) return fallback
            val fit = fit(origin, soft, size)
            return if (fit.strength >= FRACTION_FIT) fit.offset else fallback
        }
        fun corner(at: Int) = ((at % size) + size) % size
        return Grid(
            size,
            offset(area.x, changes.softAcross, otherwise?.offsetX ?: corner(zone.x)),
            offset(area.y, changes.softDown, otherwise?.offsetY ?: corner(zone.y)),
        )
    }

    /** [zone] on [grid]'s cells: those more than half inside it, one at least. */
    fun cells(zone: PixelRect, grid: Grid): Cells {
        fun index(at: Int, offset: Double) = ((at - offset) / grid.size).roundToInt()
        val column = index(zone.x, grid.offsetX)
        val row = index(zone.y, grid.offsetY)
        return Cells(
            grid.offsetX + column * grid.size, grid.offsetY + row * grid.size, grid.size,
            (index(zone.right, grid.offsetX) - column).coerceAtLeast(1), (index(zone.bottom, grid.offsetY) - row).coerceAtLeast(1),
        )
    }

    /** [zone] on [grid]'s cells, in the picture's pixels. */
    fun snap(zone: PixelRect, grid: Grid): PixelRect = cells(zone, grid).rect()

    /** [cells] at one pixel each ([reduce]). */
    fun reduce(image: RgbaImage, cells: Cells): RgbaImage = reduce(image, cells.x, cells.y, cells.size, cells.size, cells.columns, cells.rows)

    /**
     * [from] as [columns] by [rows] pixels: each one the colour its cell holds most, read away from
     * the cell's edges (where an enlarged or compressed picture bleeds). A cell outside the image
     * is transparent.
     */
    fun reduce(image: RgbaImage, from: PixelRect, columns: Int, rows: Int): RgbaImage =
        reduce(image, from.x.toDouble(), from.y.toDouble(), from.width.toDouble() / columns, from.height.toDouble() / rows, columns, rows)

    private fun reduce(image: RgbaImage, left: Double, top: Double, cellWidth: Double, cellHeight: Double, columns: Int, rows: Int): RgbaImage {
        val out = RgbaImage(columns, rows)
        fun range(start: Double, size: Double, limit: Int): IntRange {
            val inset = if (size >= 3) size * 0.2 else 0.0
            val first = floor(start + inset + 1e-6).toInt()
            val last = (ceil(start + size - inset - 1e-6).toInt() - 1).coerceAtLeast(first)
            return first.coerceAtLeast(0)..last.coerceAtMost(limit - 1)
        }
        val buckets = HashMap<Int, IntArray>()
        for (j in 0 until rows) {
            val ys = range(top + j * cellHeight, cellHeight, image.height)
            for (i in 0 until columns) {
                val xs = range(left + i * cellWidth, cellWidth, image.width)
                if (xs.isEmpty() || ys.isEmpty()) continue
                val first = rgba(image, xs.first, ys.first)
                var same = true
                buckets.clear()
                for (y in ys) for (x in xs) {
                    val colour = rgba(image, x, y)
                    if (colour != first) same = false
                    val alpha = colour and 0xff
                    // Close colours count together; what is all but transparent is one bucket.
                    val key = if (alpha < 16) -1 else ((colour ushr 27) shl 12) or (((colour ushr 19) and 0x1f) shl 7) or (((colour ushr 11) and 0x1f) shl 2) or (alpha ushr 6)
                    val bucket = buckets.getOrPut(key) { IntArray(5) }
                    bucket[0]++
                    bucket[1] += colour ushr 24
                    bucket[2] += (colour ushr 16) and 0xff
                    bucket[3] += (colour ushr 8) and 0xff
                    bucket[4] += alpha
                }
                if (same) {
                    put(out, i, j, if (first and 0xff == 0) 0 else first)
                    continue
                }
                val (key, most) = buckets.entries.maxBy { it.value[0] }
                if (key == -1) continue
                val n = most[0]
                val alpha = (most[4] + n / 2) / n
                put(out, i, j, (((most[1] + n / 2) / n) shl 24) or (((most[2] + n / 2) / n) shl 16) or (((most[3] + n / 2) / n) shl 8) or (if (alpha >= 250) 255 else alpha))
            }
        }
        return out
    }

    /**
     * The colour on [image]'s edge: the one most of its outermost pixels have, a fifth of them at
     * least, close colours counted together. 0: that is transparent already. Null: no colour
     * holds the edge (a photograph, the game's world).
     */
    fun edgeColour(image: RgbaImage): Int? {
        val buckets = HashMap<Int, IntArray>()
        var count = 0
        fun see(x: Int, y: Int) {
            val colour = rgba(image, x, y)
            count++
            val key = if (colour and 0xff < 16) -1 else ((colour ushr 27) shl 10) or (((colour ushr 19) and 0x1f) shl 5) or ((colour ushr 11) and 0x1f)
            val bucket = buckets.getOrPut(key) { IntArray(4) }
            bucket[0]++
            bucket[1] += colour ushr 24
            bucket[2] += (colour ushr 16) and 0xff
            bucket[3] += (colour ushr 8) and 0xff
        }
        for (x in 0 until image.width) {
            see(x, 0)
            if (image.height > 1) see(x, image.height - 1)
        }
        for (y in 1 until image.height - 1) {
            see(0, y)
            if (image.width > 1) see(image.width - 1, y)
        }
        val (key, most) = buckets.entries.maxBy { it.value[0] }
        if (most[0] * 5 < count) return null
        if (key == -1) return 0
        val n = most[0]
        return (((most[1] + n / 2) / n) shl 24) or (((most[2] + n / 2) / n) shl 16) or (((most[3] + n / 2) / n) shl 8) or 0xff
    }

    /**
     * Makes [background] transparent in [image]: from the edge inward, stopping at whatever is
     * further than [tolerance] from it (an element's outline), or [everywhere] (a frame's inside
     * too). Returns how many pixels it removed.
     */
    fun cutOut(image: RgbaImage, background: Int, tolerance: Int, everywhere: Boolean): Int {
        val width = image.width
        val height = image.height
        fun isBackground(x: Int, y: Int): Boolean {
            val colour = rgba(image, x, y)
            return colour and 0xff != 0 && distance(colour or 0xff, background or 0xff) <= tolerance
        }
        var removed = 0
        if (everywhere) {
            for (y in 0 until height) for (x in 0 until width) if (isBackground(x, y)) {
                put(image, x, y, 0)
                removed++
            }
            return removed
        }
        val stack = IntArray(width * height)
        var top = 0
        fun visit(x: Int, y: Int) {
            if (x < 0 || y < 0 || x >= width || y >= height || !isBackground(x, y)) return
            put(image, x, y, 0)
            removed++
            stack[top++] = y * width + x
        }
        for (x in 0 until width) {
            visit(x, 0)
            visit(x, height - 1)
        }
        for (y in 0 until height) {
            visit(0, y)
            visit(width - 1, y)
        }
        while (top > 0) {
            val at = stack[--top]
            val x = at % width
            val y = at / width
            visit(x - 1, y)
            visit(x + 1, y)
            visit(x, y - 1)
            visit(x, y + 1)
        }
        return removed
    }

    /** What [dropCut] did: the pixels it removed, and whether something that touches the edge stayed. */
    class Dropped(val pixels: Int, val keptAtEdge: Boolean)

    /**
     * Makes transparent the neighbours a rectangle cut through: each group of pixels left
     * (neighbours, corners included) that reaches [image]'s outermost pixels without reaching its
     * middle (the central half, each way). A group that reaches both stays whole: it is the
     * element, cut by the rectangle or joined to a neighbour.
     */
    fun dropCut(image: RgbaImage): Dropped {
        val width = image.width
        val height = image.height
        val seen = BooleanArray(width * height)
        val members = IntArray(width * height)
        var removed = 0
        var kept = false
        fun group(x: Int, y: Int) {
            if (image.alpha(x, y) == 0 || seen[y * width + x]) return
            var size = 0
            var head = 0
            var middle = false
            seen[y * width + x] = true
            members[size++] = y * width + x
            while (head < size) {
                val at = members[head++]
                val cx = at % width
                val cy = at / width
                if (cx * 4 >= width && cx * 4 < width * 3 && cy * 4 >= height && cy * 4 < height * 3) middle = true
                for (dy in -1..1) for (dx in -1..1) {
                    val nx = cx + dx
                    val ny = cy + dy
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
                    val to = ny * width + nx
                    if (seen[to] || image.alpha(nx, ny) == 0) continue
                    seen[to] = true
                    members[size++] = to
                }
            }
            if (middle) kept = true
            else {
                for (i in 0 until size) put(image, members[i] % width, members[i] / width, 0)
                removed += size
            }
        }
        for (x in 0 until width) {
            group(x, 0)
            group(x, height - 1)
        }
        for (y in 0 until height) {
            group(0, y)
            group(width - 1, y)
        }
        return Dropped(removed, kept)
    }

    /** The rectangle of [image] that is not transparent; null when nothing is left. */
    fun content(image: RgbaImage): PixelRect? {
        var x0 = image.width
        var y0 = image.height
        var x1 = -1
        var y1 = -1
        for (y in 0 until image.height) for (x in 0 until image.width) if (image.alpha(x, y) != 0) {
            if (x < x0) x0 = x
            if (x > x1) x1 = x
            if (y < y0) y0 = y
            if (y > y1) y1 = y
        }
        return if (x1 < 0) null else PixelRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1)
    }

    fun crop(image: RgbaImage, rect: PixelRect): RgbaImage {
        val out = RgbaImage(rect.width, rect.height)
        for (y in 0 until rect.height) {
            val sy = rect.y + y
            if (sy < 0 || sy >= image.height) continue
            val x0 = rect.x.coerceAtLeast(0)
            val x1 = rect.right.coerceAtMost(image.width)
            if (x1 > x0) System.arraycopy(image.data, (sy * image.width + x0) * 4, out.data, (y * rect.width + x0 - rect.x) * 4, (x1 - x0) * 4)
        }
        return out
    }

    /** The colours of [image] that are not transparent, alpha left aside, with how many pixels each has. */
    private fun colours(image: RgbaImage): HashMap<Int, Int> {
        val out = HashMap<Int, Int>()
        for (i in 0 until image.width * image.height) {
            val at = i * 4
            if (image.data[at + 3].toInt() == 0) continue
            out.merge(((image.data[at].toInt() and 0xff) shl 16) or ((image.data[at + 1].toInt() and 0xff) shl 8) or (image.data[at + 2].toInt() and 0xff), 1, Int::plus)
        }
        return out
    }

    private fun recolour(image: RgbaImage, to: Map<Int, Int>) {
        for (i in 0 until image.width * image.height) {
            val at = i * 4
            if (image.data[at + 3].toInt() == 0) continue
            val rgb = ((image.data[at].toInt() and 0xff) shl 16) or ((image.data[at + 1].toInt() and 0xff) shl 8) or (image.data[at + 2].toInt() and 0xff)
            val next = to[rgb] ?: continue
            image.data[at] = (next ushr 16).toByte()
            image.data[at + 1] = (next ushr 8).toByte()
            image.data[at + 2] = next.toByte()
        }
    }

    private fun apart(a: Int, b: Int): Int =
        abs((a ushr 16) - (b ushr 16)) + abs(((a ushr 8) and 0xff) - ((b ushr 8) and 0xff)) + abs((a and 0xff) - (b and 0xff))

    /**
     * Gives the colours of [image] that are within [tolerance] of a more frequent one that colour:
     * what a lossy picture turned one flat colour into. Nothing changes beyond [MAX_SETTLED]
     * colours (a photograph). Returns the number of colours left.
     */
    fun settle(image: RgbaImage, tolerance: Int): Int {
        val counts = colours(image)
        if (counts.size > MAX_SETTLED) return counts.size
        val kept = ArrayList<Int>()
        val to = HashMap<Int, Int>()
        for (colour in counts.entries.sortedWith(compareByDescending<Map.Entry<Int, Int>> { it.value }.thenBy { it.key }).map { it.key }) {
            val near = kept.firstOrNull { apart(it, colour) <= tolerance }
            if (near == null) kept += colour else to[colour] = near
        }
        recolour(image, to)
        return kept.size
    }

    /**
     * Brings [image] down to [max] colours at most (median cut, then each colour to the nearest
     * of those kept, twice refined). Alpha is left as it is. Returns the number of colours left.
     */
    fun limit(image: RgbaImage, max: Int): Int {
        val counts = colours(image)
        if (counts.size <= max) return counts.size
        var boxes = listOf(counts.keys.toIntArray())
        /** The channel a box is widest on, and how wide. */
        fun widest(box: IntArray): Pair<Int, Int> =
            (0..2).map { c -> c to (box.maxOf { (it ushr (16 - 8 * c)) and 0xff } - box.minOf { (it ushr (16 - 8 * c)) and 0xff }) }.maxBy { it.second }
        while (boxes.size < max) {
            val box = boxes.filter { it.size > 1 }.maxByOrNull { widest(it).second } ?: break
            val shift = 16 - 8 * widest(box).first
            val sorted = box.sortedBy { (it ushr shift) and 0xff }
            // Cut where half of the box's pixels are on each side, never leaving a side empty.
            val half = sorted.sumOf { counts.getValue(it).toLong() } / 2
            var seen = 0L
            val cut = sorted.indexOfFirst { seen += counts.getValue(it); seen > half }.coerceIn(1, sorted.size - 1)
            boxes = boxes.filter { it !== box } + listOf(sorted.subList(0, cut).toIntArray(), sorted.subList(cut, sorted.size).toIntArray())
        }
        fun mean(members: Collection<Int>): Int {
            val n = members.sumOf { counts.getValue(it).toLong() }.coerceAtLeast(1)
            fun channel(shift: Int) = ((members.sumOf { ((it ushr shift) and 0xff).toLong() * counts.getValue(it) } + n / 2) / n).toInt()
            return (channel(16) shl 16) or (channel(8) shl 8) or channel(0)
        }
        var palette = boxes.map { mean(it.toList()) }
        var to = emptyMap<Int, Int>()
        repeat(3) {
            to = counts.keys.associateWith { colour -> palette.minBy { apart(it, colour) } }
            palette = to.entries.groupBy({ it.value }, { it.key }).values.map(::mean)
        }
        to = counts.keys.associateWith { colour -> palette.minBy { apart(it, colour) } }
        recolour(image, to)
        return to.values.toSet().size
    }

    /** What [elements] found: the background's colour and each element's rectangle, in reading order. */
    class Elements(val background: Int, val rects: List<PixelRect>)

    /**
     * The elements [zone] holds over one background: the colour most of the zone has (a fifth at
     * least), and the rectangle of each group of pixels that differ from it, groups up to
     * two art pixels apart counted as one (the letters of a word, an icon and its shadow). The
     * lines of a frame the elements stand in (an inventory's slots) are not elements, and part
     * them ([lines]). [grid]: the art's pixels, read one by one; null when unknown. Null: the zone
     * has no single background.
     */
    fun elements(image: RgbaImage, zone: PixelRect, grid: Grid?): Elements? {
        val inside = zone.within(image) ?: return null
        val cell = grid?.size ?: 1.0
        // Whole cells of the art only, and several at a time in a zone too large to read pixel by pixel.
        val step = cell * ceil(sqrt(inside.width.toDouble() * inside.height / MASK_PIXELS) / cell).toInt().coerceAtLeast(1)
        fun first(at: Int, offset: Double) = at + (((offset - at) % cell) + cell) % cell
        val left = if (grid == null) inside.x.toDouble() else first(inside.x, grid.offsetX)
        val top = if (grid == null) inside.y.toDouble() else first(inside.y, grid.offsetY)
        val width = floor((inside.right - left) / step + 1e-6).toInt()
        val height = floor((inside.bottom - top) / step + 1e-6).toInt()
        if (width < 3 || height < 3) return null
        val colours = IntArray(width * height) {
            rgba(image, floor(left + (it % width) * step + step / 2).toInt().coerceAtMost(image.width - 1), floor(top + (it / width) * step + step / 2).toInt().coerceAtMost(image.height - 1))
        }
        val buckets = HashMap<Int, IntArray>()
        for (colour in colours) {
            val bucket = buckets.getOrPut(bucket(colour)) { IntArray(4) }
            bucket[0]++
            bucket[1] += colour ushr 24
            bucket[2] += (colour ushr 16) and 0xff
            bucket[3] += (colour ushr 8) and 0xff
        }
        val (key, most) = buckets.entries.maxBy { it.value[0] }
        if (most[0] * 5 < width * height) return null
        val n = most[0]
        val background = if (key == -1) 0 else (((most[1] + n / 2) / n) shl 24) or (((most[2] + n / 2) / n) shl 16) or (((most[3] + n / 2) / n) shl 8) or 0xff
        val solid = BooleanArray(width * height) { distance(colours[it], background) > EDGE }
        val lines = if (step == cell) lines(colours, solid, width, height) else BooleanArray(width * height)
        // Joined across gaps of two art pixels (one from each side), or of a fiftieth of the zone when the art's pixel is unknown; never across a line.
        val reach = if (cell > 1) 1 else (minOf(width, height) / 100).coerceIn(2, 8)
        val joined = spread(spread(solid, width, height, reach, across = true), width, height, reach, across = false)
        for (at in joined.indices) if (lines[at]) joined[at] = false
        val label = IntArray(width * height)
        val stack = IntArray(width * height)
        val rects = ArrayList<PixelRect>()
        var next = 0
        for (start in joined.indices) {
            if (!joined[start] || label[start] != 0) continue
            next++
            var top0 = 0
            stack[top0++] = start
            label[start] = next
            var x0 = width
            var y0 = height
            var x1 = -1
            var y1 = -1
            while (top0 > 0) {
                val at = stack[--top0]
                val x = at % width
                val y = at / width
                if (solid[at]) {
                    if (x < x0) x0 = x
                    if (x > x1) x1 = x
                    if (y < y0) y0 = y
                    if (y > y1) y1 = y
                }
                for (dy in -1..1) for (dx in -1..1) {
                    val nx = x + dx
                    val ny = y + dy
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
                    val to = ny * width + nx
                    if (joined[to] && label[to] == 0) {
                        label[to] = next
                        stack[top0++] = to
                    }
                }
            }
            if (x1 < 0) continue
            val least = if (cell > 1) 4 else 8
            val w = x1 - x0 + 1
            val h = y1 - y0 + 1
            // Specks are left out, and so is what fills the zone (that is the picture, not an element of it)
            // or reaches its edge inside the picture (the zone cut it).
            if (w < least || h < least || w.toLong() * h * 10 > width.toLong() * height * 9) continue
            val cut = (x0 == 0 && inside.x > 0) || (y0 == 0 && inside.y > 0) ||
                (x1 == width - 1 && inside.right < image.width) || (y1 == height - 1 && inside.bottom < image.height)
            if (cut) continue
            rects += Cells(left, top, step, width, height).rect(x0, y0, w, h)
        }
        val kept = rects.sortedByDescending { it.width.toLong() * it.height }.take(MAX_ELEMENTS)
        return Elements(background, reading(kept))
    }

    /** [rects] as one reads them: line after line, an element in the line its middle falls in, each line left to right. */
    private fun reading(rects: List<PixelRect>): List<PixelRect> {
        val lines = ArrayList<MutableList<PixelRect>>()
        var bottom = Int.MIN_VALUE
        for (rect in rects.sortedWith(compareBy<PixelRect> { it.y }.thenBy { it.x })) {
            if (lines.isEmpty() || rect.y + rect.height / 2 >= bottom) {
                lines += arrayListOf(rect)
                bottom = rect.bottom
            } else {
                lines.last() += rect
            }
        }
        return lines.flatMap { line -> line.sortedBy { it.x } }
    }

    /** Close colours as one number; what is all but transparent is -1. */
    private fun bucket(colour: Int): Int =
        if (colour and 0xff < 16) -1 else ((colour ushr 27) shl 10) or (((colour ushr 19) and 0x1f) shl 5) or ((colour ushr 11) and 0x1f)

    /**
     * The lines of a frame in a mask of [width] by [height] cells: a row or a column of which one
     * colour, not the background, holds [LINE_SHARE], [LINE_WIDTH] of them side by side at most (a
     * slot's light edge against the next one's dark edge; a wider band is an element), and only
     * when such lines, each running on, draw two cells at least (one outlined rectangle is an
     * element with its outline, lines one way only a striped picture). They are looked for in the whole mask, then within
     * what they cover (a window's slots do not span the picture around the window). Their cells
     * of that colour leave [solid]; the returned mask holds each line over its own length.
     */
    private fun lines(colours: IntArray, solid: BooleanArray, width: Int, height: Int): BooleanArray {
        val lines = BooleanArray(width * height)
        val drawn = BooleanArray(width * height)
        // The frame is looked for in the whole mask, then within what its lines cover: a window's slots do not span the picture around it.
        var box = intArrayOf(0, 0, width, height)
        var both = false
        repeat(3) {
            val (x0, y0, x1, y1) = box
            /** A line's cells: row [line] from x0 to x1, or column [line] from y0 to y1. */
            fun cells(line: Int, row: Boolean) = if (row) (x0 until x1).map { line * width + it } else (y0 until y1).map { it * width + line }
            /** The colour that holds [cells], close colours counted with it, or null. */
            fun colour(cells: List<Int>): Int? {
                val sums = HashMap<Int, IntArray>()
                for (at in cells) if (solid[at]) {
                    val colour = colours[at]
                    val sum = sums.getOrPut(bucket(colour)) { IntArray(4) }
                    sum[0]++
                    sum[1] += colour ushr 24
                    sum[2] += (colour ushr 16) and 0xff
                    sum[3] += (colour ushr 8) and 0xff
                }
                val most = sums.values.maxByOrNull { it[0] } ?: return null
                val n = most[0]
                val mean = ((most[1] / n) shl 24) or ((most[2] / n) shl 16) or ((most[3] / n) shl 8) or 0xff
                return mean.takeIf { cells.count { at -> solid[at] && distance(colours[at] or 0xff, mean) <= EDGE } >= LINE_SHARE * cells.size }
            }
            /** Lines [from] to [to] held by a colour, more than [LINE_WIDTH] of one colour side by side left out. */
            fun held(from: Int, to: Int, row: Boolean): Map<Int, Int> {
                val held = (from until to).map { colour(cells(it, row)) }.toMutableList()
                var start = 0
                while (start < held.size) {
                    val first = held[start]
                    if (first == null) {
                        start++
                        continue
                    }
                    var end = start
                    while (end < held.size && held[end]?.let { distance(it, first) <= EDGE } == true) end++
                    if (end - start > LINE_WIDTH) for (i in start until end) held[i] = null
                    start = end
                }
                return held.mapIndexedNotNull { i, colour -> colour?.let { from + i to it } }.toMap()
            }
            /** Marks the line itself among [cells]: its longest stretch of [colour], a cell missing here and there (where slots meet). */
            fun mark(cells: List<Int>, colour: Int): Boolean {
                fun mine(i: Int) = solid[cells[i]] && distance(colours[cells[i]] or 0xff, colour) <= EDGE
                var first = 0
                var last = -1
                var start = -1
                var previous = -1
                for (i in 0..cells.size) {
                    val here = i < cells.size && mine(i)
                    if (here && start < 0) start = i
                    if (start >= 0 && (i == cells.size || (!here && i - previous > 1))) {
                        if (previous - start > last - first) {
                            first = start
                            last = previous
                        }
                        start = -1
                    }
                    if (here) previous = i
                }
                // A line runs on: the same colour in pieces (the edges of buttons side by side) is not one.
                if (last - first + 1 < LINE_SHARE * cells.size) return false
                for (i in first..last) {
                    lines[cells[i]] = true
                    if (mine(i)) drawn[cells[i]] = true
                }
                return true
            }
            /** How many lines [held] has, those side by side counted once. */
            fun count(held: List<Int>) = held.sorted().let { sorted -> sorted.indices.count { it == 0 || sorted[it] > sorted[it - 1] + 1 } }
            val rows = held(y0, y1, row = true)
            val columns = held(x0, x1, row = false)
            lines.fill(false)
            drawn.fill(false)
            val across = count(rows.filter { (y, colour) -> mark(cells(y, row = true), colour) }.keys.toList())
            val down = count(columns.filter { (x, colour) -> mark(cells(x, row = false), colour) }.keys.toList())
            // A frame has lines both ways and two cells at least; one outlined rectangle is an element with its outline.
            both = minOf(across, down) >= 2 && maxOf(across, down) >= 3
            val marked = lines.indices.filter { lines[it] }
            if (marked.isEmpty()) return lines
            val next = intArrayOf(marked.minOf { it % width }, marked.minOf { it / width }, marked.maxOf { it % width } + 1, marked.maxOf { it / width } + 1)
            if (next.contentEquals(box)) return@repeat
            box = next
        }
        if (!both) return BooleanArray(width * height)
        for (at in drawn.indices) if (drawn[at]) solid[at] = false
        return lines
    }

    /** [mask] with each set pixel spread [reach] pixels both ways, across or down. */
    private fun spread(mask: BooleanArray, width: Int, height: Int, reach: Int, across: Boolean): BooleanArray {
        val out = BooleanArray(mask.size)
        val lines = if (across) height else width
        val length = if (across) width else height
        for (line in 0 until lines) {
            var until = -1
            fun at(i: Int) = if (across) line * width + i else i * width + line
            for (i in 0 until length) if (mask[at(i)]) {
                for (j in maxOf(until + 1, i - reach)..minOf(length - 1, i + reach)) out[at(j)] = true
                until = minOf(length - 1, i + reach)
            }
        }
        return out
    }

    private const val MAX_SETTLED = 4096
}

/**
 * A picture under a ruler, for a model to read rectangles off it (`measure_image`): [zone] of the
 * image at a size that fills about [SIDE] pixels, lines at round coordinates of the image with
 * their numbers along the top and the left, and each element found framed under its number.
 */
object ImageRulers {
    const val SIDE = 960
    private const val LEFT = 52
    private const val TOP = 20
    private const val PAD = 4
    private const val LABEL = 16
    private const val BACKDROP = 0x26262aff
    private const val NUMBER = 0xe8e8e8
    private const val LINE = 0xff30ff70.toInt()
    private const val MINOR = 0xff30ff28.toInt()
    private const val FRAME = 0xffe000ff.toInt()
    private val STEPS = listOf(1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000)

    /** How [zone] is shown: [enlarge] picture pixels per image pixel, or one for [shrink] of them. */
    class View(val enlarge: Int, val shrink: Int) {
        /** As a result says it: `x4`, `1/2`. */
        val label: String get() = if (shrink > 1) "1/$shrink" else "x$enlarge"
        fun length(pixels: Int): Int = if (shrink > 1) (pixels + shrink - 1) / shrink else pixels * enlarge
        fun position(pixels: Int): Int = if (shrink > 1) pixels / shrink else pixels * enlarge
    }

    fun view(zone: PixelRect): View {
        val longest = maxOf(zone.width, zone.height)
        return if (longest > SIDE) View(1, (longest + SIDE - 1) / SIDE) else View((SIDE / longest).coerceIn(1, 12), 1)
    }

    fun picture(image: RgbaImage, zone: PixelRect, elements: List<PixelRect> = emptyList()): RgbaImage {
        val view = view(zone)
        val width = view.length(zone.width)
        val height = view.length(zone.height)
        val canvas = MenuPictures.Canvas(RgbaImage(LEFT + width + PAD, TOP + height + PAD), LEFT, TOP)
        canvas.fill(BACKDROP.toInt())
        for (y in 0 until height) for (x in 0 until width) {
            val sx = zone.x + if (view.shrink > 1) x * view.shrink else x / view.enlarge
            val sy = zone.y + if (view.shrink > 1) y * view.shrink else y / view.enlarge
            canvas.blend(x, y, if ((x / 8 + y / 8) % 2 == 0) 0x3a3a3aff else 0x4a4a4aff)
            if (sx in 0 until image.width && sy in 0 until image.height) canvas.blend(x, y, PixelArt.rgba(image, sx, sy))
        }
        val text = MenuPictures.Text(null)
        // The closest lines whose numbers still fit side by side.
        val step = STEPS.firstOrNull { view.position(it) >= 56 } ?: STEPS.last()
        // Fainter lines between them, a fifth of the way each, else half way, while they stay apart.
        val minor = listOf(5, 2).filter { step % it == 0 }.map { step / it }.firstOrNull { view.position(it) >= 24 }
        if (minor != null) {
            var at = (zone.x + minor - 1) / minor * minor
            while (at < zone.right) {
                if (at % step != 0) view.position(at - zone.x).let { x -> for (y in 0 until height) canvas.blend(x, y, MINOR) }
                at += minor
            }
            at = (zone.y + minor - 1) / minor * minor
            while (at < zone.bottom) {
                if (at % step != 0) view.position(at - zone.y).let { y -> for (x in 0 until width) canvas.blend(x, y, MINOR) }
                at += minor
            }
        }
        var at = (zone.x + step - 1) / step * step
        while (at < zone.right) {
            val x = view.position(at - zone.x)
            for (y in 0 until height) canvas.blend(x, y, LINE)
            val label = at.toString()
            // Centred on its line; a line too close to the left edge for that goes without its number.
            val left = x - text.width(label, LABEL) / 2
            if (left >= 0) text.drawPlain(canvas, label, left, -TOP + 2, LABEL, NUMBER)
            at += step
        }
        at = (zone.y + step - 1) / step * step
        while (at < zone.bottom) {
            val y = view.position(at - zone.y)
            for (x in 0 until width) canvas.blend(x, y, LINE)
            val label = at.toString()
            if (y - LABEL / 2 >= -2) text.drawPlain(canvas, label, -text.width(label, LABEL) - 3, y - LABEL / 2, LABEL, NUMBER)
            at += step
        }
        elements.forEachIndexed { i, rect ->
            val x0 = view.position(rect.x - zone.x)
            val y0 = view.position(rect.y - zone.y)
            val x1 = x0 + view.length(rect.width) - 1
            val y1 = y0 + view.length(rect.height) - 1
            for (x in x0..x1) for (t in 0..1) {
                canvas.blend(x, y0 - 1 - t, FRAME)
                canvas.blend(x, y1 + 1 + t, FRAME)
            }
            for (y in y0 - 2..y1 + 2) for (t in 0..1) {
                canvas.blend(x0 - 1 - t, y, FRAME)
                canvas.blend(x1 + 1 + t, y, FRAME)
            }
            // The number on a plate above the frame's corner; inside it when the frame is at the top.
            val number = (i + 1).toString()
            val plate = text.width(number, LABEL) + 3
            val plateY = if (y0 - LABEL - 4 >= 0) y0 - LABEL - 4 else y0
            for (y in plateY until plateY + LABEL + 2) for (x in x0 - 2 until x0 - 2 + plate) canvas.blend(x, y, 0x101014e0)
            text.drawPlain(canvas, number, x0, plateY + 1, LABEL, 0xffe000)
        }
        return canvas.image
    }
}
