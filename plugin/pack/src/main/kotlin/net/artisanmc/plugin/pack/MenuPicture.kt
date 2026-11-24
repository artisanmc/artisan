package net.artisanmc.plugin.pack

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/** An image a menu names: its PNG, and the ascent its descriptor gives (a `background` title layer sits by it). */
class MenuPictureImage(val png: ByteArray, val ascent: Double? = null)

class MenuPictureInput(
    /** The menu's YAML. */
    val menu: String,
    /** An image of the Project by its name (`asset: <name>`); null: it has none. */
    val image: (String) -> MenuPictureImage?,
    /** A vanilla item's picture by its id (`diamond_sword`), a square PNG; null: no picture of it here. */
    val item: (String) -> ByteArray?,
    /** The language a translated text is drawn in; its first language otherwise. */
    val lang: String? = null,
)

/**
 * A menu's window drawn at the game's size, over a dark backdrop with room around it (a title
 * image may be wider than the window or start above it). [windowX], [windowY]: where the
 * window's top-left corner is in [image]. [notes]: what the picture leaves out or guesses.
 */
class MenuPicture(val image: RgbaImage, val windowX: Int, val windowY: Int, val windowWidth: Int, val windowHeight: Int, val notes: List<String>)

/**
 * What a menu looks like before a player opens it (ADR `mcp-server`, decision 11): the container,
 * the title's layers, the image buttons and their labels, then each slot's item. It reads the menu
 * as the pack does ([ImageButtonGeometry], the title layers' chest coordinates) and draws text with
 * the vanilla sheets the jar carries. Static: no expression, condition nor data source is
 * evaluated. An element shows its default look, a value in `{…}` or `%…%` is drawn as written, and
 * a slot whose item is not known until a player opens the menu shows a `?`. For a model's eyes
 * (`render_menu`): it has no twin in the editor and no shared vectors, unlike the pack build.
 */
object MenuPictures {
    private const val MARGIN_X = 16
    private const val MARGIN_TOP = 32
    private const val MARGIN_BOTTOM = 16
    private const val WIDTH = 176
    private const val BACKDROP = 0x26262aff
    private const val TITLE_COLOR = 0x404040
    /** `LABEL_INSET` of imageButtonGeometry.ts: a left or right label keeps this from the area's edge. */
    private const val LABEL_INSET = 2
    private const val COUNT_COLOR = 0xffffff
    private const val COUNT_SHADOW = 0x3f3f3f
    private const val UNKNOWN_FILL = 0x4a6fa5c8
    private const val UNKNOWN_EDGE = 0xa9c7f0ff.toInt()
    private val TAG = Regex("<[^<>]*>")
    private val HEX_TAG = Regex("<(?:color:|c:)?(#[0-9a-fA-F]{6})>")
    private val NAMED_TAG = Regex("<(?:color:|c:)?([a-z_]+)>")
    private val DYNAMIC = Regex("[{%]")
    private val EXPRESSION = Regex("\\{[^{}]*\\}")
    private val NAME = Regex("[A-Za-z_][A-Za-z0-9_]*")
    /** A path to a value (`{r.name}`, `{info[0].members}`), as opposed to a computation. */
    private val SIMPLE = Regex("\\{[A-Za-z0-9_.\\[\\]]+\\}")
    private val POSITION = Regex("^\\s*([0-9]+)(?:\\s*-\\s*([0-9]+))?\\s*$")
    private val NAMED = mapOf(
        "black" to 0x000000, "dark_blue" to 0x0000aa, "dark_green" to 0x00aa00, "dark_aqua" to 0x00aaaa, "dark_red" to 0xaa0000,
        "dark_purple" to 0xaa00aa, "gold" to 0xffaa00, "gray" to 0xaaaaaa, "grey" to 0xaaaaaa, "dark_gray" to 0x555555, "dark_grey" to 0x555555,
        "blue" to 0x5555ff, "green" to 0x55ff55, "aqua" to 0x55ffff, "red" to 0xff5555, "light_purple" to 0xff55ff, "yellow" to 0xffff55, "white" to 0xffffff,
    )

    /** @throws IllegalArgumentException when [MenuPictureInput.menu] is not a menu's YAML. */
    fun render(input: MenuPictureInput): MenuPicture {
        val doc = runCatching { Yaml.parse(input.menu) }.getOrNull() as? Map<*, *> ?: throw IllegalArgumentException("this file is not a menu")
        val type = (doc["inventory_type"] as? String)?.takeIf { it == "hopper" || it == "dropper" } ?: "chest"
        val declared = Js.toNumber(doc["size"]).takeIf { Js.isInteger(it) && it >= 1 && it <= 54 }?.toInt()
        val size = declared ?: when (type) { "hopper" -> 5; "dropper" -> 9; else -> 54 }
        val rows = (size + 8) / 9
        val height = when (type) { "hopper" -> 133; "dropper" -> 166; else -> 113 + rows * 18 }
        val hidden = doc["player_inventory"] == "hidden"
        val notes = LinkedHashSet<String>()
        val canvas = Canvas(RgbaImage(WIDTH + 2 * MARGIN_X, height + MARGIN_TOP + MARGIN_BOTTOM), MARGIN_X, MARGIN_TOP)
        canvas.fill(BACKDROP)

        if (doc["vanilla_texture"] != false) container(canvas, type, rows, height)
        val images = HashMap<String, RgbaImage?>()
        fun image(name: String): RgbaImage? = images.getOrPut(name) {
            input.image(name)?.let { runCatching { Png.decode(it.png) }.getOrNull() }.also { if (it == null) notes += "Image '$name' is not in this module: not drawn." }
        }
        val text = Text(input.lang)

        // The title, layer by layer, in chest coordinates.
        val title = doc["title"]
        for (layer in when (title) { is List<*> -> title; null -> emptyList(); else -> listOf(title) }) {
            if (layer is String) {
                if (layer.isNotEmpty()) text.draw(canvas, layer, 8, 6, 8, null)
                continue
            }
            val m = layer as? Map<*, *> ?: continue
            val x = int(m["x"])
            val y = int(m["y"])
            val asset = m["asset"] as? String ?: m["asset_id"] as? String
            when (m["kind"]) {
                "background" -> asset?.let { name -> image(name)?.let { canvas.draw(it, 0, Fonts.defaultGlyphY(input.image(name)?.ascent).toInt()) } }
                "glyph" -> asset?.let { name -> image(name)?.let { canvas.draw(it, x, y) } }
                "plain" -> text.draw(canvas, m["value"], 8, 6, 8, m["color"] as? String)
                "text" -> {
                    val textSize = sizeOf(m["size"])
                    text.draw(canvas, m["value"], x, y.coerceIn(Fonts.minYForSize(textSize), MenuReaders.TEXT_Y_MAX), textSize, m["color"] as? String)
                }
                "textarea" -> {
                    val textSize = sizeOf(m["size"])
                    val width = (if (m["width"] is Number) int(m["width"]) else 168).coerceIn(8, 256)
                    val lineHeight = (if (m["line_height"] is Number) int(m["line_height"]) else 10).coerceIn(1, 32)
                    text.block(canvas, m["value"], x, y, width, lineHeight, (m["alignment"] as? String)?.lowercase(), textSize)
                }
                "external_glyph" -> notes += "A glyph of another plugin (${m["provider"]}) is not drawn."
            }
        }

        // The elements, bottom layer first: the last one to claim a slot shows there.
        val limit = size + if (hidden) 36 else 0
        val elements: List<Map<*, *>> = when {
            doc["elements"] is List<*> -> doc["elements"] as List<*>
            doc["layers"] is List<*> -> (doc["layers"] as List<*>).flatMap { ((it as? Map<*, *>)?.get("elements") as? List<*>).orEmpty() }
            else -> emptyList()
        }.filterIsInstance<Map<*, *>>()
        val owner = HashMap<Int, Map<*, *>>()
        val slotsOf = elements.associateWith { slots(it, limit) }
        for (el in elements) for (slot in slotsOf.getValue(el)) owner[slot] = el
        var withStates = 0
        var rowBound = 0
        val missingItems = LinkedHashSet<String>()
        var unknownItems = 0

        fun look(el: Map<*, *>): Map<*, *> {
            val states = (el["states"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()
            if (states.isNotEmpty()) withStates++
            val shows = listOf("material", "image", "item", "asset", "head", "label").any { el[it] != null }
            return if (!shows && states.isNotEmpty()) states.first() else el
        }
        val looks = elements.associateWith(::look)

        for (el in elements) {
            val mine = slotsOf.getValue(el).filter { owner[it] === el }
            if (mine.isEmpty()) continue
            val look = looks.getValue(el)
            val bound = Js.truthy(el["iterates"]) || Js.truthy(el["places"])
            if (bound) rowBound++
            // A fixed element is one rectangle; a row-bound one shows its look in each slot it may fill.
            val areas = if (bound) mine.mapNotNull { ImageButtonGeometry.area(listOf(it), type, size, hidden) }
            else listOfNotNull(ImageButtonGeometry.area(slotsOf.getValue(el), type, size, hidden))
            val picture = (look["image"] as? Map<*, *>)?.let { spec -> (spec["asset"] as? String)?.takeIf { it.isNotEmpty() }?.let { name -> image(name)?.let { spec to it } } }
            for (area in areas) {
                if (picture != null) {
                    val (spec, source) = picture
                    val placement = ImageButtonPlacement(
                        "", spec["fit"] as? String ?: "contain", (spec["offset_x"] as? Number)?.toDouble(), (spec["offset_y"] as? Number)?.toDouble(),
                        area.width * 18, area.height * 18, area.y,
                    )
                    canvas.draw(ImageButtons.render(source, placement).first, area.x.toInt(), area.y.toInt())
                }
                // `labelFrame` (imageButtonGeometry.ts): a text block anchored in the area, centred on the 7 px cap height.
                val label = look["label"] as? Map<*, *> ?: continue
                val textSize = sizeOf(label["size"])
                val align = label["align"] as? String
                val width = area.width * 18
                val anchor = area.x.toInt() + when (align) { "left" -> LABEL_INSET; "right" -> width - LABEL_INSET; else -> width / 2 }
                val top = area.y.toInt() + (area.height * 18 - 7 * textSize / 8) / 2
                text.block(canvas, label["text"], anchor + int(label["offset_x"]), top + int(label["offset_y"]), width, textSize + 2, align ?: "center", textSize)
            }
        }

        // Items: over the title, as the game draws them.
        fun item(look: Map<*, *>, slot: Int) {
            if (look["image"] != null) return
            val area = ImageButtonGeometry.area(listOf(slot), type, size, hidden) ?: return
            val x = area.x.toInt() + 1
            val y = area.y.toInt() + 1
            val material = (look["material"] as? String)?.takeIf { it.isNotBlank() } ?: ("player_head".takeIf { look["head"] != null })
            when {
                material == null && look["item"] == null && look["asset"] == null -> return
                material == null || DYNAMIC.containsMatchIn(material) -> { unknownItems++; unknown(canvas, text, x, y) }
                else -> {
                    val id = material.trim().lowercase().removePrefix("minecraft:")
                    if (id == "air") return
                    val icon = input.item(id)?.let { runCatching { Png.decode(it) }.getOrNull() }
                    if (icon == null) { missingItems += id; unknown(canvas, text, x, y) } else canvas.draw(scaled(icon, 16), x, y)
                }
            }
            val count = (look["count"] as? Number)?.toInt() ?: 1
            if (count > 1) {
                val digits = count.toString()
                val left = x + 17 - text.width(digits, 8)
                text.drawPlain(canvas, digits, left + 1, y + 10, 8, COUNT_SHADOW)
                text.drawPlain(canvas, digits, left, y + 9, 8, COUNT_COLOR)
            }
        }
        for ((slot, el) in owner.toSortedMap()) item(looks.getValue(el), slot)
        (doc["background"] as? Map<*, *>)?.let { background -> for (slot in 0 until size) if (slot !in owner) item(background, slot) }

        if (withStates > 0) notes += "$withStates element(s) have states: the default look is drawn, not the one a condition would choose."
        if (rowBound > 0) notes += "$rowBound element(s) are filled from data (iterates/places): their look is drawn in every slot they may fill."
        if (unknownItems > 0) notes += "$unknownItems slot(s) show `?`: their item is an expression or a custom model, known only when a player opens the menu."
        if (missingItems.isNotEmpty()) notes += "No picture here for: ${missingItems.take(12).joinToString(", ")}${if (missingItems.size > 12) "…" else ""} (shown as `?`; an unknown item id, or the item pictures are still downloading: try again in a minute)."
        if (text.unresolved) notes += "Values in `{…}` and `%…%` exist only in game: each is drawn as its name (`{name}`) or `{…}`, so its width is a guess."
        if (text.undrawn) notes += "Some characters have no glyph in the vanilla sheets used here and are left out."
        return MenuPicture(canvas.image, MARGIN_X, MARGIN_TOP, WIDTH, height, notes.toList())
    }

    /** [image] with each pixel a square of [scale]: what a model looks at. */
    fun enlarge(image: RgbaImage, scale: Int): RgbaImage {
        val out = RgbaImage(image.width * scale, image.height * scale)
        for (y in 0 until out.height) for (x in 0 until out.width)
            System.arraycopy(image.data, ((y / scale) * image.width + x / scale) * 4, out.data, (y * out.width + x) * 4, 4)
        return out
    }

    private fun container(canvas: Canvas, type: String, rows: Int, height: Int) {
        val file = when (type) { "hopper" -> "hopper.png"; "dropper" -> "dispenser.png"; else -> "generic_54.png" }
        val source = Png.decode(ResourcePackBuilder.vanillaResource(file))
        // A texture pack's container may be larger than 256: one pixel of the window is then several of it.
        val k = (source.width / 256).coerceAtLeast(1)
        fun part(srcY: Int, h: Int, toY: Int) {
            val piece = RgbaImage(WIDTH * k, h * k)
            Png.bitblt(source, piece, 0, srcY * k, WIDTH * k, h * k, 0, 0)
            canvas.draw(if (k == 1) piece else scaled(piece, WIDTH, h), 0, toY)
        }
        if (type == "chest") {
            val top = 17 + rows * 18
            part(0, top, 0)
            part(126, 96, top)
        } else part(0, height, 0)
    }

    private fun unknown(canvas: Canvas, text: Text, x: Int, y: Int) {
        for (dy in 0 until 16) for (dx in 0 until 16)
            canvas.blend(x + dx, y + dy, if (dx == 0 || dy == 0 || dx == 15 || dy == 15) UNKNOWN_EDGE else UNKNOWN_FILL.toInt())
        text.drawPlain(canvas, "?", x + 6, y + 4, 8, 0xffffff)
    }

    private fun scaled(source: RgbaImage, side: Int) = scaled(source, side, side)

    private fun scaled(source: RgbaImage, width: Int, height: Int): RgbaImage {
        if (source.width == width && source.height == height) return source
        val out = RgbaImage(width, height)
        for (y in 0 until height) for (x in 0 until width)
            System.arraycopy(source.data, ((y * source.height / height) * source.width + x * source.width / width) * 4, out.data, (y * width + x) * 4, 4)
        return out
    }

    private fun int(v: Any?): Int = (v as? Number)?.toDouble()?.takeIf { !it.isNaN() && !it.isInfinite() }?.coerceIn(-100000.0, 100000.0)?.toInt() ?: 0

    private fun sizeOf(v: Any?): Int = int(v).takeIf { it in MenuReaders.TEXT_SIZES } ?: 8

    /** The slots an element claims: its `positions` (`"4"`, `"10-16,19"`), else its placements'. */
    private fun slots(el: Map<*, *>, limit: Int): List<Int> {
        val out = LinkedHashSet<Int>()
        val positions = el["positions"]
        if (positions != null) {
            for (part in Js.string(positions).split(",")) {
                val match = POSITION.find(part) ?: return emptyList()
                val a = match.groupValues[1].toIntOrNull() ?: return emptyList()
                val b = match.groupValues[2].ifEmpty { match.groupValues[1] }.toIntOrNull() ?: return emptyList()
                if (a >= limit || b >= limit) return emptyList()
                for (i in minOf(a, b)..maxOf(a, b)) out += i
            }
        } else {
            for (p in ((el["places"] as? Map<*, *>)?.get("placements") as? List<*>).orEmpty()) {
                val position = ((p as? Map<*, *>)?.get("position") as? Number)?.toInt() ?: continue
                if (position in 0 until limit) out += position
            }
        }
        return out.toList()
    }

    /** The picture being drawn; coordinates are the window's, [originX], [originY] its corner in [image]. */
    private class Canvas(val image: RgbaImage, val originX: Int, val originY: Int) {
        fun fill(rgba: Int) {
            for (i in 0 until image.width * image.height) put(i * 4, rgba)
        }

        private fun put(at: Int, rgba: Int) {
            image.data[at] = (rgba ushr 24).toByte()
            image.data[at + 1] = (rgba ushr 16).toByte()
            image.data[at + 2] = (rgba ushr 8).toByte()
            image.data[at + 3] = rgba.toByte()
        }

        /** [rgba] over the pixel at window ([x], [y]); outside the picture, nothing. */
        fun blend(x: Int, y: Int, rgba: Int) {
            val px = x + originX
            val py = y + originY
            if (px < 0 || py < 0 || px >= image.width || py >= image.height) return
            val alpha = rgba and 0xff
            if (alpha == 0) return
            val at = (py * image.width + px) * 4
            for (c in 0..2) {
                val over = (rgba ushr (24 - 8 * c)) and 0xff
                val under = image.data[at + c].toInt() and 0xff
                image.data[at + c] = ((over * alpha + under * (255 - alpha)) / 255).toByte()
            }
            image.data[at + 3] = 0xff.toByte()
        }

        fun draw(source: RgbaImage, x: Int, y: Int) {
            for (sy in 0 until source.height) for (sx in 0 until source.width) {
                val at = (sy * source.width + sx) * 4
                val d = source.data
                blend(x + sx, y + sy, ((d[at].toInt() and 0xff) shl 24) or ((d[at + 1].toInt() and 0xff) shl 16) or ((d[at + 2].toInt() and 0xff) shl 8) or (d[at + 3].toInt() and 0xff))
            }
        }
    }

    /** Text in the vanilla bitmap sheets, at a title size (8 is the game's own). */
    private class Text(private val lang: String?) {
        var unresolved = false
        var undrawn = false

        private class Sheet(val image: RgbaImage, val font: VanillaFont) {
            val cellWidth = image.width / TextChars.COLUMNS
            val cellHeight = image.height / font.chars.size
        }

        private class Glyph(val sheet: Sheet, val column: Int, val row: Int, val width: Int)

        private val sheets by lazy {
            listOf("ascii" to Fonts.ASCII, "accented" to Fonts.ACCENTED, "nonlatin_european" to Fonts.NONLATIN_EUROPEAN)
                .map { (name, font) -> Sheet(Png.decode(ResourcePackBuilder.vanillaResource("font/${name}_up.png")), font) }
        }
        private val glyphs = HashMap<Int, Glyph?>()

        private fun glyph(codepoint: Int): Glyph? = glyphs.getOrPut(codepoint) {
            for (sheet in sheets) sheet.font.chars.forEachIndexed { row, line ->
                val column = line.codePoints().toArray().indexOf(codepoint)
                if (column < 0 || codepoint == 0) return@forEachIndexed
                var width = 0
                for (x in 0 until sheet.cellWidth) for (y in 0 until sheet.font.height)
                    if (sheet.image.alpha(column * sheet.cellWidth + x, row * sheet.cellHeight + y) != 0) width = maxOf(width, x + 1)
                return@getOrPut Glyph(sheet, column, row, width)
            }
            null
        }

        private fun advance(codepoint: Int, size: Int): Int = when {
            codepoint == ' '.code -> ceil(4 * size / 8.0).toInt()
            else -> glyph(codepoint)?.let { ceil((it.width + 1) * size / 8.0).toInt() } ?: 0
        }

        fun width(text: String, size: Int): Int = text.codePoints().toArray().sumOf { advance(it, size) }

        /** A text field's value (a string, or one text per language), without its tags. */
        fun plain(value: Any?): String {
            val raw = raw(value)
            if (DYNAMIC.containsMatchIn(raw)) unresolved = true
            // An expression is drawn by its last name (`{info[0].name}` → `{name}`): closer to the width of a value.
            return EXPRESSION.replace(TAG.replace(raw, "")) { match ->
                if (match.value.startsWith("{i18n:")) match.value
                else NAME.findAll(match.value).lastOrNull()?.takeIf { SIMPLE.matches(match.value) }?.let { "{${it.value}}" } ?: "{…}"
            }
        }

        private fun raw(value: Any?): String = when (value) {
            is String -> value
            is Map<*, *> -> (value["key"] as? String)?.let { "{i18n:$it}" }
                ?: (value[lang] ?: value["en"] ?: value.values.firstOrNull()) as? String ?: ""
            else -> ""
        }

        /** The colour a text is drawn in: its layer's, else its first colour tag's, else the title's. */
        fun colour(value: Any?, layer: String?): Int {
            layer?.let { parse(it) }?.let { return it }
            val raw = raw(value)
            HEX_TAG.find(raw)?.let { return it.groupValues[1].drop(1).toInt(16) }
            NAMED_TAG.findAll(raw).firstNotNullOfOrNull { NAMED[it.groupValues[1]] }?.let { return it }
            return TITLE_COLOR
        }

        private fun parse(colour: String): Int? = NAMED[colour.lowercase()] ?: colour.takeIf { it.matches(Regex("#[0-9a-fA-F]{6}")) }?.drop(1)?.toInt(16)

        fun draw(canvas: Canvas, value: Any?, x: Int, y: Int, size: Int, layerColour: String?) = drawPlain(canvas, plain(value), x, y, size, colour(value, layerColour))

        /** [text]'s first row of pixels at window [y]: a taller sheet (accents) starts above it. */
        fun drawPlain(canvas: Canvas, text: String, x: Int, y: Int, size: Int, rgb: Int) {
            var cursor = x
            val rgba = (rgb shl 8) or 0xff
            for (codepoint in text.codePoints().toArray()) {
                val glyph = glyph(codepoint)
                if (glyph == null) {
                    if (codepoint != ' '.code) undrawn = true
                } else {
                    val font = glyph.sheet.font
                    val top = y - ((font.ascent - Fonts.ASCII.ascent) * size / 8.0).roundToInt()
                    val w = (glyph.sheet.cellWidth * size / 8.0).roundToInt()
                    val h = (font.height * size / 8.0).roundToInt()
                    for (dy in 0 until h) for (dx in 0 until w) {
                        val sx = glyph.column * glyph.sheet.cellWidth + dx * 8 / size
                        val sy = glyph.row * glyph.sheet.cellHeight + dy * 8 / size
                        if (glyph.sheet.image.alpha(sx, sy) != 0) canvas.blend(cursor + dx, top + dy, rgba)
                    }
                }
                cursor += advance(codepoint, size)
            }
        }

        /**
         * A text block as the title compiler lays it out: lines no wider than [width], each one
         * starting at [x] (left), centred on it or ending at it, [lineHeight] apart; a line above
         * the highest text font is drawn at it, one below the lowest is dropped.
         */
        fun block(canvas: Canvas, value: Any?, x: Int, y: Int, width: Int, lineHeight: Int, alignment: String?, size: Int) {
            val rgb = colour(value, null)
            lines(value, size, width).forEachIndexed { i, line ->
                val lineY = (y + i * lineHeight).coerceAtLeast(Fonts.minYForSize(size))
                if (lineY > MenuReaders.TEXT_Y_MAX || line.isEmpty()) return@forEachIndexed
                val lineWidth = width(line, size)
                drawPlain(canvas, line, when (alignment) { "center" -> x - lineWidth / 2; "right" -> x - lineWidth; else -> x }, lineY, size, rgb)
            }
        }

        /** [value] cut into lines no wider than [width], at spaces; a written line break starts a new one. */
        fun lines(value: Any?, size: Int, width: Int): List<String> {
            val out = ArrayList<String>()
            for (paragraph in plain(raw(value).replace("<br>", "\n")).trimStart().split('\n')) {
                var line = ""
                for (word in paragraph.split(' ')) {
                    val next = if (line.isEmpty()) word else "$line $word"
                    if (line.isNotEmpty() && width(next, size) > width) {
                        out += line
                        line = word
                    } else line = next
                }
                out += line
            }
            return out
        }
    }
}
