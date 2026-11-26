package net.artisanmc.plugin.pack

/**
 * A composed image: a recipe the pack assembles, in place of a PNG (`compose.ts`). Its
 * descriptor (`assets/textures/<name>.yml`, no PNG beside it) lists layers, bottom first:
 *
 * ```yaml
 * compose:
 *   - use: "kit:window.6"       # an image, at x and y (0 by default)
 *   - image: guilds_icon
 *     x: 19
 *     y: 4
 *   - grid: "kit:cell"          # an image repeated, one beside and under the other
 *     x: 7
 *     y: 139
 *     columns: 9
 *     rows: 4
 *   - image: panel              # a sliced image ([Slices]), drawn at a size
 *     x: 7
 *     y: 17
 *     width: 72
 *     height: 36
 * ```
 *
 * `use`, `image` and `grid` name an image the same way: `kit:<name>` ([Kit]) or a PNG of the
 * module, never another composed image. The image is as large as `width` and `height` say, else
 * as far as its first layer reaches. It follows the kit: redraw `kit:window.6` and every image
 * composed with it changes. `width` and `height` on a layer resize an image whose descriptor
 * declares margins (`slice`): corners copied, edges and middle repeated. On another image, or
 * at a size its margins do not fit, they are ignored and the image is drawn at its own size.
 */
object ComposedImages {
    /** A side of a composed image, and how far a layer may sit from the origin. */
    const val MAX_SIDE = 512
    const val MAX_LAYERS = 64
    /** Columns or rows of a `grid` layer. */
    const val MAX_REPEAT = 64

    /** [width], [height]: the size a sliced image is drawn at; null for its own size. Never on a layer that repeats. */
    class Layer(val image: String, val x: Int, val y: Int, val columns: Int, val rows: Int, val width: Int? = null, val height: Int? = null)

    class Recipe(val layers: List<Layer>, val width: Int?, val height: Int?)

    private fun int(value: Any?, min: Int, max: Int): Int? =
        (value as? Number)?.toDouble()?.takeIf { it == Math.rint(it) && it >= min && it <= max }?.toInt()

    /** The recipe a descriptor holds; null when it describes a PNG (no `compose` list). */
    fun recipe(descriptor: Map<*, *>): Recipe? {
        val entries = descriptor["compose"] as? List<*> ?: return null
        val layers = ArrayList<Layer>()
        for (entry in entries) {
            if (layers.size >= MAX_LAYERS) break
            val m = entry as? Map<*, *> ?: continue
            val use = m["use"] as? String ?: m["image"] as? String
            val image = (use ?: m["grid"] as? String)?.takeIf { it.isNotEmpty() } ?: continue
            // Repeated only when `grid` is what names the image.
            val repeats = use == null
            val w = int(m["width"], 1, MAX_SIDE)
            val h = int(m["height"], 1, MAX_SIDE)
            layers += Layer(
                image,
                int(m["x"], -MAX_SIDE, MAX_SIDE) ?: 0,
                int(m["y"], -MAX_SIDE, MAX_SIDE) ?: 0,
                if (repeats) int(m["columns"], 1, MAX_REPEAT) ?: 1 else 1,
                if (repeats) int(m["rows"], 1, MAX_REPEAT) ?: 1 else 1,
                // A size only with both sides, and never on a layer that repeats.
                w.takeIf { !repeats && h != null },
                h.takeIf { !repeats && w != null },
            )
        }
        val width = int(descriptor["width"], 1, MAX_SIDE)
        val height = int(descriptor["height"], 1, MAX_SIDE)
        return if (width != null && height != null) Recipe(layers, width, height) else Recipe(layers, null, null)
    }

    /** The recipe the text of a descriptor holds; null when it has none, or cannot be read. */
    fun read(descriptor: String): Recipe? = (Yaml.parseOrNull(descriptor) as? Map<*, *>)?.let(::recipe)

    /**
     * [recipe] drawn from files: [own] gives a PNG of the module by its name, [kit] the PNG
     * `kit:<name>` shows by the name after `kit:` ([Kit.image], in the server's theme). A layer
     * whose file is missing or unreadable is left out. [slice]: the margins of a layer's image,
     * by the name the layer writes (`kit:<name>` or a module's).
     */
    fun render(recipe: Recipe, own: (String) -> ByteArray?, kit: (String) -> ByteArray?, slice: (String) -> Slice? = { null }): RgbaImage? {
        val decoded = HashMap<String, RgbaImage?>()
        return compose(recipe, slice) { name ->
            decoded.getOrPut(name) {
                val inKit = Kit.nameOf(name)
                val png = if (inKit != null) kit(inKit) else own(name)
                png?.let { runCatching { Png.decode(it) }.getOrNull() }
            }
        }
    }

    /**
     * The image [recipe] gives, [image] reading a layer's (null: the server has none, the layer
     * is left out) and [slice] its margins when it is a sliced image. Null when no layer could
     * be drawn. Without a size of its own, the image reaches as far as its first layer at that
     * layer's own size.
     */
    fun compose(recipe: Recipe, slice: (String) -> Slice? = { null }, image: (String) -> RgbaImage?): RgbaImage? {
        val drawn = recipe.layers.mapNotNull { layer -> image(layer.image)?.let { layer to it } }
        val (first, piece) = drawn.firstOrNull() ?: return null
        val width = recipe.width ?: (first.x + first.columns * piece.width).coerceIn(1, MAX_SIDE)
        val height = recipe.height ?: (first.y + first.rows * piece.height).coerceIn(1, MAX_SIDE)
        val out = RgbaImage(width, height)
        for ((layer, plain) in drawn) {
            val source = picture(layer, plain, slice(layer.image))
            for (row in 0 until layer.rows) for (column in 0 until layer.columns) {
                over(out, source, layer.x + column * source.width, layer.y + row * source.height)
            }
        }
        return out
    }

    /** A layer's image as it is drawn: resized when the layer gives a size its margins fit. */
    fun picture(layer: Layer, source: RgbaImage, slice: Slice?): RgbaImage {
        val width = layer.width
        val height = layer.height
        if (slice == null || width == null || height == null) return source
        if (width == source.width && height == source.height) return source
        return if (Slices.at(slice, source, width, height)) Slices.draw(source, slice, width, height) else source
    }

    /** [source] over [target] at ([left], [top]), clipped: plain alpha compositing on whole numbers, as `compose.ts` does it. */
    fun over(target: RgbaImage, source: RgbaImage, left: Int, top: Int) {
        for (y in maxOf(0, -top) until minOf(source.height, target.height - top)) {
            for (x in maxOf(0, -left) until minOf(source.width, target.width - left)) {
                val s = (y * source.width + x) * 4
                val d = ((y + top) * target.width + x + left) * 4
                val sa = source.data[s + 3].toInt() and 0xff
                if (sa == 0) continue
                val da = target.data[d + 3].toInt() and 0xff
                if (sa == 255 || da == 0) {
                    System.arraycopy(source.data, s, target.data, d, 4)
                    continue
                }
                // Alpha times 255, so that every division is one of whole numbers.
                val under = da * (255 - sa)
                val alpha = sa * 255 + under
                for (c in 0..2) {
                    val sc = source.data[s + c].toInt() and 0xff
                    val dc = target.data[d + c].toInt() and 0xff
                    target.data[d + c] = ((sc * sa * 255 + dc * under + alpha / 2) / alpha).toByte()
                }
                target.data[d + 3] = ((alpha + 127) / 255).toByte()
            }
        }
    }
}
