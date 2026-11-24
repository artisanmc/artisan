package net.artisanmc.plugin.pack

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt
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
    private const val MAX_ELEMENTS = 24
    private const val MASK_PIXELS = 1_000_000

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

    /** One pixel of the art is [size] pixels of the picture, the cells starting at [offsetX], [offsetY] (each below [size]). */
    class Grid(val size: Int, val offsetX: Int, val offsetY: Int)

    /**
     * The grid [zone]'s edges fall on: the largest cell, from [MAX_CELL] down to 2, whose
     * boundaries hold [GRID_SHARE] of the colour changes, across and down. Null: the zone is not
     * enlarged pixel art (drawn at its own size, smooth, or resized by a fraction), or too plain to tell.
     */
    fun grid(image: RgbaImage, zone: PixelRect): Grid? {
        val area = zone.within(image) ?: return null
        val across = LongArray(area.width)
        val down = LongArray(area.height)
        for (y in area.y until area.bottom) for (x in area.x until area.right) {
            val here = rgba(image, x, y)
            if (x > area.x) distance(here, rgba(image, x - 1, y)).let { if (it > EDGE) across[x - area.x] += it.toLong() }
            if (y > area.y) distance(here, rgba(image, x, y - 1)).let { if (it > EDGE) down[y - area.y] += it.toLong() }
        }
        for (size in MAX_CELL downTo 2) {
            val x = residue(across, area.x, size) ?: continue
            val y = residue(down, area.y, size) ?: continue
            return Grid(size, x, y)
        }
        return null
    }

    /**
     * [grid] of [zone], else of what surrounds it, else of the whole image: a plain element says
     * nothing of the art's pixel, the picture it stands in does.
     */
    fun gridAround(image: RgbaImage, zone: PixelRect): Grid? =
        grid(image, zone) ?: grid(image, zone.grown(maxOf(zone.width, zone.height))) ?: grid(image, PixelRect(0, 0, image.width, image.height))

    /** Where cells of [size] start (modulo [size]) when they explain the [changes] counted from [origin]; null when they do not. */
    private fun residue(changes: LongArray, origin: Int, size: Int): Int? {
        if (changes.count { it > 0 } < 3) return null
        val sums = LongArray(size)
        changes.forEachIndexed { i, change -> sums[(origin + i) % size] += change }
        val best = sums.indices.maxBy { sums[it] }
        return best.takeIf { sums[it] >= GRID_SHARE * sums.sum() }
    }

    /** [zone] on [grid]'s cells: those more than half inside it, one at least. */
    fun snap(zone: PixelRect, grid: Grid): PixelRect {
        fun edge(at: Int, offset: Int) = offset + ((at - offset).toDouble() / grid.size).roundToInt() * grid.size
        val x0 = edge(zone.x, grid.offsetX)
        val y0 = edge(zone.y, grid.offsetY)
        val x1 = edge(zone.right, grid.offsetX).coerceAtLeast(x0 + grid.size)
        val y1 = edge(zone.bottom, grid.offsetY).coerceAtLeast(y0 + grid.size)
        return PixelRect(x0, y0, x1 - x0, y1 - y0)
    }

    /**
     * [from] as [columns] by [rows] pixels: each one the colour its cell holds most, read away from
     * the cell's edges (where an enlarged or compressed picture bleeds). A cell outside the image
     * is transparent.
     */
    fun reduce(image: RgbaImage, from: PixelRect, columns: Int, rows: Int): RgbaImage {
        val out = RgbaImage(columns, rows)
        val cellWidth = from.width.toDouble() / columns
        val cellHeight = from.height.toDouble() / rows
        fun range(start: Double, size: Double, limit: Int): IntRange {
            val inset = if (size >= 3) size * 0.2 else 0.0
            val first = floor(start + inset + 1e-6).toInt()
            val last = (ceil(start + size - inset - 1e-6).toInt() - 1).coerceAtLeast(first)
            return first.coerceAtLeast(0)..last.coerceAtMost(limit - 1)
        }
        val buckets = HashMap<Int, IntArray>()
        for (j in 0 until rows) {
            val ys = range(from.y + j * cellHeight, cellHeight, image.height)
            for (i in 0 until columns) {
                val xs = range(from.x + i * cellWidth, cellWidth, image.width)
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
     * two art pixels apart counted as one (the letters of a word, an icon and its shadow). [grid]: the
     * art's pixels, read one by one; null when unknown. Null: the zone has no single background.
     */
    fun elements(image: RgbaImage, zone: PixelRect, grid: Grid?): Elements? {
        val inside = zone.within(image) ?: return null
        val cell = grid?.size ?: 1
        // Whole cells of the art only, and several at a time in a zone too large to read pixel by pixel.
        val step = cell * ceil(sqrt(inside.width.toDouble() * inside.height / MASK_PIXELS) / cell).toInt().coerceAtLeast(1)
        val left = if (grid == null) inside.x else inside.x + Math.floorMod(grid.offsetX - inside.x, cell)
        val top = if (grid == null) inside.y else inside.y + Math.floorMod(grid.offsetY - inside.y, cell)
        val area = PixelRect(left, top, inside.right - left, inside.bottom - top)
        val width = area.width / step
        val height = area.height / step
        if (width < 3 || height < 3) return null
        fun sample(x: Int, y: Int) = rgba(image, area.x + x * step + step / 2, area.y + y * step + step / 2)
        val buckets = HashMap<Int, IntArray>()
        for (y in 0 until height) for (x in 0 until width) {
            val colour = sample(x, y)
            val bucket = buckets.getOrPut(if (colour and 0xff < 16) -1 else ((colour ushr 27) shl 10) or (((colour ushr 19) and 0x1f) shl 5) or ((colour ushr 11) and 0x1f)) { IntArray(4) }
            bucket[0]++
            bucket[1] += colour ushr 24
            bucket[2] += (colour ushr 16) and 0xff
            bucket[3] += (colour ushr 8) and 0xff
        }
        val (key, most) = buckets.entries.maxBy { it.value[0] }
        if (most[0] * 5 < width * height) return null
        val n = most[0]
        val background = if (key == -1) 0 else (((most[1] + n / 2) / n) shl 24) or (((most[2] + n / 2) / n) shl 16) or (((most[3] + n / 2) / n) shl 8) or 0xff
        val solid = BooleanArray(width * height) { distance(sample(it % width, it / width), background) > EDGE }
        // Joined across gaps of two art pixels (one from each side), or of a fiftieth of the zone when the art's pixel is unknown.
        val reach = if (cell > 1) 1 else (minOf(width, height) / 100).coerceIn(2, 8)
        val joined = spread(spread(solid, width, height, reach, across = true), width, height, reach, across = false)
        val label = IntArray(width * height)
        val stack = IntArray(width * height)
        val rects = ArrayList<PixelRect>()
        var next = 0
        for (start in joined.indices) {
            if (!joined[start] || label[start] != 0) continue
            next++
            var top = 0
            stack[top++] = start
            label[start] = next
            var x0 = width
            var y0 = height
            var x1 = -1
            var y1 = -1
            while (top > 0) {
                val at = stack[--top]
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
                        stack[top++] = to
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
            rects += PixelRect(area.x + x0 * step, area.y + y0 * step, w * step, h * step)
        }
        val kept = rects.sortedByDescending { it.width.toLong() * it.height }.take(MAX_ELEMENTS)
        return Elements(background, kept.sortedWith(compareBy<PixelRect> { it.y }.thenBy { it.x }))
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
