package net.artisanmc.plugin.pack

import kotlin.math.floor

internal enum class GuiContainer(val key: String, val textureFile: String) {
    CHEST("chest", "generic_54"),
    HOPPER("hopper", "hopper"),
    DISPENSER("dispenser", "dispenser"),
}

internal data class GlyphPlacement(val assetId: String, val y: Double)

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
                if (Js.truthy(el["iterates"]) || Js.truthy(el["places"])) continue
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
        return out
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
