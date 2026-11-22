package net.artisanmc.plugin.pack

import kotlin.math.floor

internal enum class GuiContainer(val key: String, val textureFile: String) {
    CHEST("chest", "generic_54"),
    HOPPER("hopper", "hopper"),
    DISPENSER("dispenser", "dispenser"),
}

internal data class GlyphPlacement(val assetId: String, val y: Double)

/** A title text of [size] whose top sits at chest [y]: one `text_y{y}_h{size}` font. */
internal data class TextPlacement(val y: Int, val size: Int)

internal data class ImageButtonPlacement(
    val asset: String,
    val fit: String,
    val offsetX: Double?,
    val offsetY: Double?,
    val width: Int,
    val height: Int,
    val y: Double,
)

/** What a Project's menus ask of the pack (`menuGlyphPlacements.ts`, `imageButtons.ts`, `vanillaGui.ts`). */
internal object MenuReaders {
    /** The module's menus and its variants' (`DocumentLayout`), in file order. */
    private fun menus(files: List<PackFile>): Sequence<Any?> {
        val paths = DocumentLayout.menuPaths(files.map { it.path })
        return files.asSequence().filter { it.path in paths }.mapNotNull { f ->
            // An unreadable menu is skipped: the plugin does not render it either.
            runCatching { Yaml.parse(f.content) }.fold({ Holder(it) }, { null })
        }.map { it.value }
    }

    private class Holder(val value: Any?)

    /** Glyph title layers: which image sits at which Y, for a `glyph_y{Y}` font per Y in use. */
    fun glyphPlacements(files: List<PackFile>): List<GlyphPlacement> {
        val out = ArrayList<GlyphPlacement>()
        for (doc in menus(files)) {
            val title = (doc as? Map<*, *>)?.get("title")
            val layers = when (title) {
                is List<*> -> title
                is Map<*, *> -> listOf(title)
                else -> emptyList()
            }
            for (layer in layers) {
                if (layer !is Map<*, *>) continue
                if (layer["kind"] != "glyph" || layer["y"] !is Number) continue
                val asset = layer["asset"]
                val assetId = if (asset is String) asset else layer["asset_id"]
                if (assetId is String) out += GlyphPlacement(assetId, (layer["y"] as Number).toDouble())
            }
        }
        return out
    }

    private val MENU_CONTAINER = mapOf("chest" to GuiContainer.CHEST, "hopper" to GuiContainer.HOPPER, "dropper" to GuiContainer.DISPENSER)

    /** Containers whose menus turn their vanilla texture off (`vanilla_texture: false`). */
    fun transparentContainers(files: List<PackFile>): Set<GuiContainer> {
        val out = LinkedHashSet<GuiContainer>()
        for (doc in menus(files)) {
            val map = doc as? Map<*, *>
            val type = map?.get("inventory_type")
            val container = MENU_CONTAINER[Js.string(type ?: "chest")]
            if (map?.get("vanilla_texture") == false && container != null) out += container
        }
        return out
    }

    private const val WS = "[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]"
    private val POSITION = Regex("^$WS*([0-9]+)(?:$WS*-$WS*([0-9]+))?$WS*$")

    fun imageButtons(files: List<PackFile>): List<ImageButtonPlacement> {
        val out = ArrayList<ImageButtonPlacement>()
        for (raw in menus(files)) {
            val doc = raw as? Map<*, *> ?: if (raw is List<*>) emptyMap<String, Any?>() else continue
            val inventoryType = doc["inventory_type"]
            val type = if (inventoryType == "hopper" || inventoryType == "dropper") inventoryType as String else "chest"
            val hidden = doc["player_inventory"] == "hidden"
            val size = Js.toNumber(doc["size"])
            if (!Js.isInteger(size) || size < 1 || size > 54) continue
            val sizeInt = size.toInt()
            val limit = sizeInt + if (hidden) 36 else 0
            val elements: List<Any?> = when {
                doc["elements"] is List<*> -> doc["elements"] as List<*>
                doc["layers"] is List<*> -> (doc["layers"] as List<*>).flatMap { layer ->
                    when (val e = (layer as? Map<*, *>)?.get("elements")) {
                        null -> emptyList()
                        is List<*> -> e
                        else -> listOf(e)
                    }
                }
                else -> emptyList()
            }
            for (element in elements) {
                if (!Js.truthy(element)) continue
                val el = element as? Map<*, *> ?: emptyMap<String, Any?>()
                // A row-bound element (iterates/places) shows one image per slot, chosen per
                // row: each slot of it is an 18×18 area of its own (`imageButtons.ts`).
                if (Js.truthy(el["iterates"]) || Js.truthy(el["places"])) {
                    for (slot in rowSlots(el, limit)) {
                        val area = ImageButtonGeometry.area(listOf(slot), type, sizeInt, hidden) ?: continue
                        pushImages(out, el, area)
                    }
                    continue
                }
                val slots = LinkedHashSet<Int>()
                var valid = true
                for (part in Js.string(el["positions"] ?: "").split(",")) {
                    val match = POSITION.find(part)
                    if (match == null) {
                        valid = false
                        break
                    }
                    val a = match.groupValues[1].toDouble()
                    val b = match.groupValues[2].ifEmpty { match.groupValues[1] }.toDouble()
                    if (a >= limit || b >= limit) {
                        valid = false
                        break
                    }
                    for (i in minOf(a, b).toInt()..maxOf(a, b).toInt()) slots += i
                }
                if (!valid || slots.isEmpty()) continue
                val area = ImageButtonGeometry.area(slots.toList(), type, sizeInt, hidden) ?: continue
                pushImages(out, el, area)
            }
        }
        return out
    }

    /** Lowest chest Y a text font exists for (`TitleCompiler.TEXT_Y_MAX`). */
    const val TEXT_Y_MAX = 172
    val TEXT_SIZES = listOf(8, 12, 16, 20, 24, 32)
    private const val Y_BOUND = 100000.0

    /** A YAML number as the plugin's `toInt()` reads it; anything else is 0 (`int`, menuTextPlacements.ts). */
    private fun int(v: Any?): Int {
        val d = (v as? Number)?.toDouble() ?: return 0
        if (d.isNaN() || d.isInfinite()) return 0
        return d.coerceIn(-Y_BOUND, Y_BOUND).toInt()
    }

    /** `MenuTitleParser.parseSize`: a size out of the set is 8. */
    private fun sizeOf(v: Any?): Int = int(v).takeIf { it in TEXT_SIZES } ?: 8

    /**
     * A text block: every line it may draw down to the bottom of the window, since how many it
     * has depends on the player. Lines above the floor are drawn at it.
     */
    private fun pushBlock(out: MutableList<TextPlacement>, y: Int, size: Int, lineHeight: Int) {
        if (y > TEXT_Y_MAX) return
        val floor = Fonts.minYForSize(size)
        var line = y
        if (y < floor) {
            out += TextPlacement(floor, size)
            line = y + ((floor - y + lineHeight - 1) / lineHeight) * lineHeight
        }
        while (line <= TEXT_Y_MAX) {
            out += TextPlacement(line, size)
            line += lineHeight
        }
    }

    /**
     * The (Y, size) of every text the menus may draw in a title: `text` and `textarea` layers,
     * and the labels of fixed elements (`menuTextPlacements.ts`).
     */
    fun textPlacements(files: List<PackFile>): List<TextPlacement> {
        val out = ArrayList<TextPlacement>()
        for (raw in menus(files)) {
            val doc = raw as? Map<*, *> ?: continue
            val title = doc["title"]
            val layers = when (title) {
                is List<*> -> title
                is Map<*, *> -> listOf(title)
                else -> emptyList()
            }
            for (layer in layers) {
                if (layer !is Map<*, *>) continue
                when (layer["kind"]) {
                    "text" -> {
                        val size = sizeOf(layer["size"])
                        out += TextPlacement(int(layer["y"]).coerceIn(Fonts.minYForSize(size), TEXT_Y_MAX), size)
                    }
                    "textarea" -> {
                        val lineHeight = if (layer["line_height"] is Number) int(layer["line_height"]).coerceIn(1, 32) else 10
                        pushBlock(out, int(layer["y"]), sizeOf(layer["size"]), lineHeight)
                    }
                }
            }
            pushLabels(out, doc)
        }
        return out
    }

    /** Labels of fixed elements, over the same rectangle as an image button. */
    private fun pushLabels(out: MutableList<TextPlacement>, doc: Map<*, *>) {
        val inventoryType = doc["inventory_type"]
        val type = if (inventoryType == "hopper" || inventoryType == "dropper") inventoryType as String else "chest"
        val hidden = doc["player_inventory"] == "hidden"
        val size = Js.toNumber(doc["size"])
        if (!Js.isInteger(size) || size < 1 || size > 54) return
        val sizeInt = size.toInt()
        val limit = sizeInt + if (hidden) 36 else 0
        val elements: List<Any?> = when {
            doc["elements"] is List<*> -> doc["elements"] as List<*>
            doc["layers"] is List<*> -> (doc["layers"] as List<*>).flatMap { layer ->
                when (val e = (layer as? Map<*, *>)?.get("elements")) {
                    null -> emptyList()
                    is List<*> -> e
                    else -> listOf(e)
                }
            }
            else -> emptyList()
        }
        for (element in elements) {
            val el = element as? Map<*, *> ?: continue
            if (Js.truthy(el["iterates"]) || Js.truthy(el["places"])) continue
            val appearances = listOf<Any?>(el) + ((el["states"] as? List<*>) ?: emptyList())
            val labels = appearances.mapNotNull { (it as? Map<*, *>)?.get("label") as? Map<*, *> }
            if (labels.isEmpty()) continue
            val slots = LinkedHashSet<Int>()
            var valid = true
            for (part in Js.string(el["positions"] ?: "").split(",")) {
                val match = POSITION.find(part)
                if (match == null) {
                    valid = false
                    break
                }
                val a = match.groupValues[1].toDouble()
                val b = match.groupValues[2].ifEmpty { match.groupValues[1] }.toDouble()
                if (a >= limit || b >= limit) {
                    valid = false
                    break
                }
                for (i in minOf(a, b).toInt()..maxOf(a, b).toInt()) slots += i
            }
            if (!valid || slots.isEmpty()) continue
            val area = ImageButtonGeometry.area(slots.toList(), type, sizeInt, hidden) ?: continue
            for (label in labels) {
                // `labelFrame` (imageButtonGeometry.ts): centred vertically on the 7 px cap height, then shifted.
                val textSize = sizeOf(label["size"])
                val top = area.y.toInt() + (area.height * 18 - 7 * textSize / 8) / 2 + int(label["offset_y"])
                pushBlock(out, top, textSize, textSize + 2)
            }
        }
    }

    /** The slots a row-bound element may fill: its positions (iterates), else its placements' (places). */
    private fun rowSlots(el: Map<*, *>, limit: Int): List<Int> {
        val slots = sortedSetOf<Int>()
        if (Js.truthy(el["iterates"])) {
            for (part in Js.string(el["positions"] ?: "").split(",")) {
                val match = POSITION.find(part) ?: return emptyList()
                val a = match.groupValues[1].toDouble()
                val b = match.groupValues[2].ifEmpty { match.groupValues[1] }.toDouble()
                if (a >= limit || b >= limit) return emptyList()
                for (i in minOf(a, b).toInt()..maxOf(a, b).toInt()) slots += i
            }
        } else {
            val placements = (el["places"] as? Map<*, *>)?.get("placements") as? List<*> ?: return emptyList()
            for (p in placements) {
                val position = (p as? Map<*, *>)?.get("position") as? Number ?: continue
                if (Js.isInteger(position) && position.toDouble() >= 0 && position.toDouble() < limit) slots += position.toInt()
            }
        }
        return slots.toList()
    }

    /** One placement per image appearance of [el] over [area]. */
    private fun pushImages(out: MutableList<ImageButtonPlacement>, el: Map<*, *>, area: ImageButtonGeometry.Area) {
        val appearances = listOf(el) + ((el["states"] as? List<*>) ?: emptyList())
        for (app in appearances) {
            val image = (app as? Map<*, *>)?.get("image") as? Map<*, *> ?: continue
            val asset = image["asset"] as? String
            if (asset.isNullOrEmpty()) continue
            if (image.containsKey("fit") && image["fit"] !in listOf("contain", "stretch", "native")) continue
            val ox = image["offset_x"] ?: 0
            val oy = image["offset_y"] ?: 0
            if (!Js.isSafeInteger(ox) || !Js.isSafeInteger(oy)) continue
            out += ImageButtonPlacement(
                asset = asset,
                fit = image["fit"] as? String ?: "contain",
                offsetX = (image["offset_x"] as? Number)?.toDouble()?.takeIf { it != 0.0 },
                offsetY = (image["offset_y"] as? Number)?.toDouble()?.takeIf { it != 0.0 },
                width = area.width * 18,
                height = area.height * 18,
                y = area.y,
            )
        }
    }
}

/** `docs/schema/menu/v1/imageButtonGeometry.ts`: the rectangle and origin the editor and the plugin share. */
internal object ImageButtonGeometry {
    class Area(val slot: Int, val width: Int, val height: Int, val x: Double, val y: Double)
    class Box(val width: Int, val height: Int, val x: Int, val y: Int)

    private class Grid(val cols: Int, val x: Int, val y: Int)
    private val MENU_GRID = mapOf("chest" to Grid(9, 7, 17), "hopper" to Grid(5, 43, 19), "dropper" to Grid(3, 61, 16))

    private fun playerInventoryY(type: String, size: Int): Double = when (type) {
        "hopper" -> 50.0
        "dropper" -> 83.0
        else -> 30 + (size / 9.0) * 18
    }

    private class Cell(val section: Int, val col: Int, val row: Int, val x: Double, val y: Double)

    fun area(slots: List<Int>, type: String, size: Int, playerInventoryHidden: Boolean): Area? {
        if (slots.isEmpty()) return null
        val limit = size + if (playerInventoryHidden) 36 else 0
        val cells = slots.map { slot ->
            if (slot < 0 || slot >= limit) return null
            if (slot < size) {
                val g = MENU_GRID.getValue(type)
                Cell(0, slot % g.cols, slot / g.cols, g.x.toDouble(), g.y.toDouble())
            } else {
                val j = slot - size
                val top = playerInventoryY(type, size)
                if (j < 27) Cell(1, j % 9, j / 9, 7.0, top) else Cell(2, j - 27, 0, 7.0, top + 58)
            }
        }
        if (cells.any { it.section != cells[0].section }) return null
        val left = cells.minOf { it.col }
        val right = cells.maxOf { it.col }
        val topRow = cells.minOf { it.row }
        val bottomRow = cells.maxOf { it.row }
        val width = right - left + 1
        val height = bottomRow - topRow + 1
        if (slots.toSet().size != width * height) return null
        val first = cells[0]
        return Area(slots.min(), width, height, first.x + left * 18, first.y + topRow * 18)
    }

    fun geometry(fit: String, offsetX: Double?, offsetY: Double?, sourceWidth: Int, sourceHeight: Int, areaWidth: Int, areaHeight: Int): Box {
        val ratio = if (fit == "native") 1.0 else minOf(areaWidth.toDouble() / sourceWidth, areaHeight.toDouble() / sourceHeight)
        val width = if (fit == "stretch") areaWidth else maxOf(1, Math.round(sourceWidth * ratio).toInt())
        val height = if (fit == "stretch") areaHeight else maxOf(1, Math.round(sourceHeight * ratio).toInt())
        return Box(
            width,
            height,
            floor((areaWidth - width) / 2.0).toInt() + (offsetX ?: 0.0).toInt(),
            floor((areaHeight - height) / 2.0).toInt() + (offsetY ?: 0.0).toInt(),
        )
    }
}
