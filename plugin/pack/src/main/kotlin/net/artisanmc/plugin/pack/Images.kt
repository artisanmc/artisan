package net.artisanmc.plugin.pack

import kotlin.math.floor

/** The pack's `asset-index.json` (`assetIndexBuilder.ts`), mutable while buttons and overlays add to it. */
internal class AssetIndex(assets: List<AssetRow>, transparent: Set<GuiContainer>?) {
    val assets = LinkedHashMap<String, Map<String, Any?>>()
    private val offsets = LinkedHashMap<String, Any?>()
    private val vanillaGui: Map<String, Any?>?

    init {
        for (a in assets) {
            val entry = LinkedHashMap<String, Any?>()
            entry["name"] = a.name
            entry["type"] = a.type
            entry["ascent"] = a.ascent
            entry["height"] = a.height
            entry["width"] = a.contentWidth ?: a.width
            if (a.type == "glyph" && a.codepoint != null) entry["codepoint"] = a.codepoint
            if (a.type == "font") {
                val namespace = when (val meta = a.fontMeta) {
                    is FontMeta -> meta.namespace
                    is Map<*, *> -> meta["namespace"] as? String
                    else -> null
                }
                if (namespace != null) entry["namespace"] = namespace
            }
            this.assets[a.id] = entry
        }
        for ((codepoint, advance) in Fonts.spaceOffsetTable()) offsets[codepoint.toString(16).uppercase()] = advance
        vanillaGui = transparent?.let {
            mapOf(
                "transparent_chests" to (GuiContainer.CHEST in it),
                "transparent_hoppers" to (GuiContainer.HOPPER in it),
                "transparent_dispensers" to (GuiContainer.DISPENSER in it),
            )
        }
    }

    fun json(): Map<String, Any?> = LinkedHashMap<String, Any?>().apply {
        put("version", 2)
        put("assets", assets)
        put("offsets", offsets)
        if (vanillaGui != null) put("vanilla_gui", vanillaGui)
    }
}

/**
 * Container textures rebuilt as `artisan:vanilla_gui` title glyphs (`vanillaGui.ts`): a menu with
 * `vanilla_texture: false` makes its container transparent for every window, the plugin draws
 * the texture back as a glyph on the others.
 */
internal object VanillaGui {
    const val FONT = "assets/artisan/font/vanilla_gui.json"
    private const val TITLE_X = 8
    private const val TOP_ASCENT = 13
    private const val TITLE_H = 17
    private const val ROW_H = 18
    private const val BOTTOM_SRC_Y = 126
    private const val BOTTOM_H = 96
    private const val WIDTH = 176

    fun override(c: GuiContainer) = "assets/minecraft/textures/gui/container/${c.textureFile}.png"

    /** Scale of a container texture (1 = 256×256), or null if it isn't one. */
    private fun textureScale(png: RgbaImage): Int? =
        if (png.width != png.height || png.width < 256 || png.width % 256 != 0) null else png.width / 256

    /** The image `project:image` names when it has the vanilla layout; null → the vanilla texture. */
    fun textureSource(images: List<Pair<String, ByteArray>>, ref: String?): ByteArray? {
        val bytes = ref?.let { r -> images.firstOrNull { it.first == r }?.second } ?: return null
        return try {
            if (textureScale(Png.decode(bytes)) != null) bytes else null
        } catch (_: Exception) {
            null
        }
    }

    private fun chestWindow(src: RgbaImage, rows: Int, k: Int): RgbaImage {
        val topH = (TITLE_H + rows * ROW_H) * k
        val out = RgbaImage(WIDTH * k, topH + BOTTOM_H * k)
        Png.bitblt(src, out, 0, 0, WIDTH * k, topH, 0, 0)
        Png.bitblt(src, out, 0, BOTTOM_SRC_Y * k, WIDTH * k, BOTTOM_H * k, 0, topH)
        return out
    }

    private fun boxWindow(src: RgbaImage, height: Int, k: Int): RgbaImage {
        val out = RgbaImage(WIDTH * k, height * k)
        Png.bitblt(src, out, 0, 0, WIDTH * k, height * k, 0, 0)
        return out
    }

    private fun contentWidth(png: RgbaImage): Int {
        for (x in png.width - 1 downTo 0) for (y in 0 until png.height) if (png.alpha(x, y) != 0) return x + 1
        return 0
    }

    fun files(sources: Map<GuiContainer, ByteArray>, transparent: Set<GuiContainer>, files: MutableMap<String, ByteArray>) {
        val providers = ArrayList<Any?>()
        val advances = LinkedHashMap<String, Any?>()
        advances[cp(0xe010)] = -TITLE_X
        fun glyph(name: String, codepoint: Int, png: RgbaImage, k: Int) {
            files["assets/artisan/textures/gui/$name.png"] = Png.encode(png)
            providers += mapOf(
                "type" to "bitmap",
                "file" to "artisan:gui/$name.png",
                "ascent" to TOP_ASCENT,
                "height" to png.height.toDouble() / k,
                "chars" to listOf(cp(0xe000 + codepoint)),
            )
            advances[cp(0xe010 + codepoint)] = -(Math.round(contentWidth(png).toDouble() / k) + 1) + TITLE_X
        }

        val chest = Png.decode(sources.getValue(GuiContainer.CHEST))
        val kc = textureScale(chest) ?: 1
        for (rows in 1..6) glyph("generic_9x$rows", rows, chestWindow(chest, rows, kc), kc)
        for ((box, height, codepoint) in listOf(Triple(GuiContainer.HOPPER, 133, 7), Triple(GuiContainer.DISPENSER, 166, 8))) {
            val src = Png.decode(sources.getValue(box))
            val k = textureScale(src) ?: 1
            glyph(box.key, codepoint, boxWindow(src, height, k), k)
        }
        providers += mapOf("type" to "space", "advances" to advances)
        files[FONT] = Js.stringifyBytes(mapOf("providers" to providers), 2)
        for (container in transparent) files[override(container)] = Png.encode(RgbaImage(256, 256))
    }

    private fun cp(codepoint: Int) = String(Character.toChars(codepoint))
}

/** Image buttons drawn as title glyphs (`imageButtons.ts`). */
internal object ImageButtons {
    fun key(b: ImageButtonPlacement): String {
        val hash = sha256Hex(b.asset.toByteArray(Charsets.UTF_8))
        val offsets = if (b.offsetX != null || b.offsetY != null) "_${Js.numberString(b.offsetX ?: 0.0)}_${Js.numberString(b.offsetY ?: 0.0)}" else ""
        return "buttons/${hash}_${b.width}_${b.height}_${b.fit}_${Js.numberString(b.y)}$offsets"
    }

    /** The button's image in its area (`renderImageButton`), and the width MC measures for it. */
    fun render(input: RgbaImage, button: ImageButtonPlacement): Pair<RgbaImage, Int> {
        val output = RgbaImage(button.width, button.height)
        val g = ImageButtonGeometry.geometry(button.fit, button.offsetX, button.offsetY, input.width, input.height, button.width, button.height)
        var contentWidth = 0
        for (y in maxOf(0, -g.y) until minOf(g.height, button.height - g.y)) {
            for (x in maxOf(0, -g.x) until minOf(g.width, button.width - g.x)) {
                val src = (floor(y.toDouble() * input.height / g.height).toInt() * input.width + floor(x.toDouble() * input.width / g.width).toInt()) * 4
                val dest = ((y + g.y) * button.width + x + g.x) * 4
                System.arraycopy(input.data, src, output.data, dest, 4)
                if (input.data[src + 3].toInt() != 0) contentWidth = maxOf(contentWidth, x + g.x + 1)
            }
        }
        return output to contentWidth
    }

    fun build(files: MutableMap<String, ByteArray>, index: AssetIndex, pngs: Map<String, ByteArray>, placements: List<ImageButtonPlacement>) {
        if (placements.isNotEmpty()) {
            files["assets/artisan/items/buttons/hit_area.json"] = Js.stringifyBytes(mapOf("model" to mapOf("type" to "minecraft:empty")))
        }
        for (button in placements) {
            val key = key(button)
            if (index.assets.containsKey(key)) continue
            val source = pngs[button.asset] ?: continue
            val (output, contentWidth) = render(Png.decode(source), button)
            files["assets/artisan/textures/$key.png"] = Png.encode(output)
            val ascent = 13 - button.y
            files["assets/artisan/font/$key.json"] = Js.stringifyBytes(
                mapOf(
                    "providers" to listOf(
                        mapOf("type" to "bitmap", "file" to "artisan:$key.png", "height" to button.height, "ascent" to ascent, "chars" to listOf("")),
                    ),
                ),
            )
            index.assets[key] = mapOf(
                "name" to key,
                "type" to "glyph",
                "codepoint" to 0xe000,
                "ascent" to ascent,
                "height" to button.height,
                "width" to contentWidth,
                "namespace" to "artisan:$key",
            )
        }
    }
}

/**
 * An image a module asks the pack for (`pack.images`, SDK 1.13): at a rise above the text's top,
 * or by its bottom (resolved once its height is known).
 */
data class OverlayImageRequest(val asset: String, val rise: Int? = null, val bottom: Int? = null) {
    init {
        require((rise == null) != (bottom == null)) { "an overlay image has a rise or a bottom, not both" }
    }
}

/** Module images at a height, as `artisan:overlay/…` fonts (`overlayImages.ts`). */
internal object OverlayImages {
    private const val TEXT_ASCENT = 7
    const val MIN_RISE = -166
    private const val SLICE = 256

    fun inRange(rise: Int) = rise >= MIN_RISE && rise <= Fonts.TEXT_UP_MAX

    fun key(asset: String, rise: Int) = "overlay/${sha256Hex(asset.toByteArray(Charsets.UTF_8))}_$rise"

    private fun contentWidth(image: RgbaImage, from: Int, to: Int): Int {
        for (x in to - 1 downTo from) for (y in 0 until image.height) if (image.alpha(x, y) != 0) return x - from + 1
        return 0
    }

    fun build(files: MutableMap<String, ByteArray>, index: AssetIndex, pngs: Map<String, ByteArray>, requests: List<OverlayImageRequest>) {
        val decoded = HashMap<String, RgbaImage>()
        for (request in requests) {
            val source = pngs[request.asset] ?: continue
            val input = decoded.getOrPut(request.asset) { Png.decode(source) }
            val rise = request.rise ?: (input.height - request.bottom!!)
            if (!inRange(rise)) continue
            val key = key(request.asset, rise)
            if (index.assets.containsKey(key)) continue
            val ascent = TEXT_ASCENT + rise
            val height = maxOf(input.height, ascent)
            if (height > SLICE || input.width == 0) continue
            val providers = ArrayList<Any?>()
            val slices = ArrayList<Int>()
            var i = 0
            var x = 0
            while (x < input.width) {
                val width = minOf(SLICE, input.width - x)
                val slice = RgbaImage(width, height)
                Png.bitblt(input, slice, x, 0, width, input.height, 0, 0)
                files["assets/artisan/textures/${key}_$i.png"] = Png.encode(slice)
                providers += mapOf(
                    "type" to "bitmap",
                    "file" to "artisan:${key}_$i.png",
                    "ascent" to ascent,
                    "height" to height,
                    "chars" to listOf(String(Character.toChars(0xe000 + i))),
                )
                slices += contentWidth(input, x, x + width)
                i++
                x += SLICE
            }
            files["assets/artisan/font/$key.json"] = Js.stringifyBytes(mapOf("providers" to providers))
            index.assets[key] = mapOf(
                "name" to request.asset,
                "type" to "overlay",
                "codepoint" to 0xe000,
                "ascent" to ascent,
                "height" to height,
                "width" to input.width,
                "namespace" to "artisan:$key",
                "slices" to slices,
                "imageHeight" to input.height,
            )
        }
    }
}
