package net.artisanmc.plugin.pack

import kotlin.math.floor

/*
 * The Bedrock resource pack (`.mcpack`) of a server, port of the editor's `bedrock/` builders: for each
 * styled menu, a composed background, the images of its buttons and the screen file that places
 * them. Same inputs, same bytes: the `bedrock` part of `testdata/resource-pack-conformance.json`
 * locks both builders. Geyser hands the pack to Bedrock players (`GeyserIntegration`).
 */

/** `Math.round`: halves up, toward +∞. */
internal fun jsRound(d: Double): Double {
    if (d.isNaN() || d.isInfinite()) return d
    val f = floor(d)
    return if (d - f >= 0.5) f + 1 else f
}

/** The title Bedrock players receive for a styled menu (`bedrockTitle.ts`, `BedrockTitle.kt` in paper). */
internal object BedrockTitle {
    private const val KEY_BASE = 0xf880
    private const val KEY_RANGE = 0x7f
    private const val BUTTON_BASE = 0xf800
    const val BUTTON_MAX = 64
    private const val STATE_BASE = 0xf840
    const val STATE_MAX = 64
    const val TEXT_FIELD = 64
    const val TEXTAREA_FIELD = 192
    const val MARKER = ""
    const val PAD = ""
    /** Fills the 2 or 4 bytes a 3-byte [PAD] cannot; also stripped by the pack. */
    const val PAD2 = "\u00A0"
    private const val CONTROL_BYTES = 3

    /** `variant` empty for the module's own menu; a variant's menu hashes `project:menu@variant`. */
    fun menuKey(projectId: String, menuId: String, variant: String = ""): String {
        val seed = if (variant.isEmpty()) "$projectId:$menuId" else "$projectId:$menuId@$variant"
        val hex = sha256Hex(seed.toByteArray(Charsets.UTF_8))
        val b0 = hex.substring(0, 2).toInt(16)
        val b1 = hex.substring(2, 4).toInt(16)
        return String(Character.toChars(KEY_BASE + b0 % KEY_RANGE)) + String(Character.toChars(KEY_BASE + b1 % KEY_RANGE))
    }

    fun buttonPair(index: Int, state: Int): String =
        String(Character.toChars(BUTTON_BASE + index)) + String(Character.toChars(STATE_BASE + state))

    fun fieldOffset(buttons: Int, fields: List<Int>, index: Int): Int {
        var offset = CONTROL_BYTES * (1 + 2 + 2 * buttons)
        for (i in 0 until index) offset += fields.getOrElse(i) { 0 }
        return offset
    }
}

internal class BedrockButtonImage(
    val asset: String,
    val fit: String,
    val offsetX: Double?,
    val offsetY: Double?,
    val state: Int,
)

internal class BedrockButton(
    val index: Int,
    val x: Double,
    val y: Double,
    val width: Int,
    val height: Int,
    val images: List<BedrockButtonImage>,
)

internal class BedrockTextLayer(
    val index: Int,
    val length: Int,
    val x: Double,
    val y: Double,
    val scale: Double,
    val color: String?,
    val width: Double? = null,
    val alignment: String? = null,
)

internal class BedrockImageLayer(val asset: String, val x: Double, val y: Double?)

internal class BedrockMenu(
    val projectId: String,
    val id: String,
    val key: String,
    val rows: Int,
    val transparent: Boolean,
    val images: List<BedrockImageLayer>,
    val texts: List<BedrockTextLayer>,
    val buttons: List<BedrockButton>,
) {
    fun withButtons(buttons: List<BedrockButton>) = BedrockMenu(projectId, id, key, rows, transparent, images, texts, buttons)
}

/**
 * Where a module's Documents live (`documentLayout.ts`, `DocumentLayout.kt` in core): zero to three
 * themed folders, then the kind folder, then `<id>.yml`. With `variants.yml` at the module root,
 * `variants/<name>/` holds a variant laid out the same way (design `variantes-modules`). Only what
 * the packs need: the id and variant of each Document path, duplicates left out.
 */
internal object DocumentLayout {
    private val RESOURCE_DIRS = setOf("lang", "items", "data", "models", "templates", "assets", "overrides", "config")
    private const val MAX_FOLDER_DEPTH = 3
    private val FOLDER = Regex("^[a-z0-9][a-z0-9_-]*$")

    /** A Document's id, and its variant (`""` for the module's own). */
    data class Doc(val id: String, val variant: String)

    /** Document path → [Doc], for the kinds of [kindDirs]. */
    fun docs(paths: List<String>, kindDirs: Set<String>): Map<String, Doc> {
        val candidates = ArrayList<Triple<String, String, Doc>>()
        val variantsOn = paths.any { '/' !in it && YamlPaths.stem(it) == "variants" }
        for (path in paths.sorted()) {
            var rest = path
            var variant = ""
            if (variantsOn && path.startsWith("variants/")) {
                val segs = path.split("/")
                if (segs.size < 3 || !FOLDER.matches(segs[1])) continue
                variant = segs[1]
                rest = segs.drop(2).joinToString("/")
            }
            val segs = rest.split("/")
            if (segs.any { it.isEmpty() || it.startsWith(".") }) continue
            val id = YamlPaths.stem(segs.last()) ?: continue
            val dirs = segs.dropLast(1)
            if (dirs.isEmpty() || dirs[0] in RESOURCE_DIRS) continue
            val kindAt = dirs.indexOfFirst { it in kindDirs }
            if (kindAt < 0 || kindAt != dirs.size - 1) continue
            val folders = dirs.subList(0, kindAt)
            if (folders.any { it in RESOURCE_DIRS || !FOLDER.matches(it) } || folders.size > MAX_FOLDER_DEPTH) continue
            candidates += Triple(path, dirs[kindAt], Doc(id, variant))
        }
        val key = { c: Triple<String, String, Doc> -> c.third.variant + "\u0000" + c.second + "\u0000" + c.third.id }
        val count = candidates.groupingBy(key).eachCount()
        return candidates.filter { count.getValue(key(it)) == 1 }.associate { it.first to it.third }
    }

    /** The menu files of a module, its variants' included, as the plugin reads them. */
    fun menuPaths(paths: List<String>): Set<String> = docs(paths, setOf("menus")).keys
}

/** The menus of a Project the Bedrock pack styles (`bedrockMenus.ts`): chests of 3 or 6 rows. */
internal object BedrockMenus {
    private const val PLAIN_X = 8.0
    private const val PLAIN_Y = 6.0
    private const val WS = "[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]"
    private val POSITION = Regex("^$WS*([0-9]+)(?:$WS*-$WS*([0-9]+))?$WS*$")
    private val LEADING_COLOR = Regex("^$WS*<(?:color:|c:)?(#[0-9a-fA-F]{6}|[a-z_]+)>")
    private val FITS = listOf("contain", "stretch", "native")

    private fun slotsOf(positions: Any?, limit: Int): List<Int>? {
        val slots = LinkedHashSet<Int>()
        for (part in Js.string(positions ?: "").split(",")) {
            val match = POSITION.find(part) ?: return null
            val a = match.groupValues[1].toDouble()
            val b = match.groupValues[2].ifEmpty { match.groupValues[1] }.toDouble()
            if (a >= limit || b >= limit) return null
            for (i in minOf(a, b).toInt()..maxOf(a, b).toInt()) slots += i
        }
        return slots.toList().ifEmpty { null }
    }

    private fun imageOf(app: Any?): BedrockButtonImage? {
        val image = (app as? Map<*, *>)?.get("image") as? Map<*, *> ?: return null
        val asset = image["asset"] as? String
        if (asset.isNullOrEmpty()) return null
        if (image.containsKey("fit") && image["fit"] !in FITS) return null
        if (!Js.isSafeInteger(image["offset_x"] ?: 0) || !Js.isSafeInteger(image["offset_y"] ?: 0)) return null
        return BedrockButtonImage(
            asset,
            image["fit"] as? String ?: "contain",
            (image["offset_x"] as? Number)?.toDouble()?.takeIf { it != 0.0 },
            (image["offset_y"] as? Number)?.toDouble()?.takeIf { it != 0.0 },
            -1,
        )
    }

    /** The color tag a value opens with: the plugin sends Bedrock the text without its tags. */
    fun leadingColor(value: Any?): String? = (value as? String)?.let { LEADING_COLOR.find(it)?.groupValues?.get(1) }

    private fun asList(value: Any?): List<Any?> = when {
        value is List<*> -> value
        Js.truthy(value) -> listOf(value)
        else -> emptyList()
    }

    private fun textLayers(title: Any?): List<BedrockTextLayer> {
        val out = ArrayList<BedrockTextLayer>()
        for (layer in asList(title)) {
            val t: Map<*, *> = if (layer is String) mapOf("kind" to "plain", "value" to layer) else layer as? Map<*, *> ?: continue
            val kind = t["kind"]
            if (kind != "text" && kind != "plain" && kind != "textarea") continue
            val index = out.size
            val size = (t["size"] as? Number)?.toDouble()?.takeIf { it > 0 } ?: 8.0
            val color = t["color"] as? String ?: leadingColor(t["value"])
            if (kind == "plain") {
                out += BedrockTextLayer(index, BedrockTitle.TEXT_FIELD, PLAIN_X, PLAIN_Y, 1.0, color)
                continue
            }
            val x = (t["x"] as? Number)?.toDouble() ?: continue
            val y = (t["y"] as? Number)?.toDouble() ?: continue
            if (kind == "text") {
                out += BedrockTextLayer(index, BedrockTitle.TEXT_FIELD, x, y, size / 8, color)
                continue
            }
            val alignment = Js.string(t["alignment"]).takeIf { it in listOf("left", "center", "right") } ?: "left"
            val width = (t["width"] as? Number)?.toDouble() ?: 160.0
            out += BedrockTextLayer(index, BedrockTitle.TEXTAREA_FIELD, x, y, size / 8, color, width, alignment)
        }
        return out
    }

    fun fromProject(projectId: String, files: List<PackFile>): List<BedrockMenu> {
        val out = ArrayList<BedrockMenu>()
        // The id is the file name, wherever the menu sits (themed folders included), as the plugin reads it.
        // A variant's menu gets its own key: the plugin sends it for that variant only.
        val docs = DocumentLayout.docs(files.map { it.path }, setOf("menus"))
        for (file in files) {
            val (id, variant) = docs[file.path] ?: continue
            val doc = runCatching { Yaml.parse(file.content) }.getOrNull() as? Map<*, *> ?: continue
            if (doc.containsKey("inventory_type") && doc["inventory_type"] != "chest") continue
            if (doc["player_inventory"] == "hidden") continue
            val size = Js.toNumber(doc["size"])
            if (size != 27.0 && size != 54.0) continue
            val sizeInt = size.toInt()
            val rows = if (sizeInt == 27) 3 else 6

            val images = ArrayList<BedrockImageLayer>()
            for (layer in asList(doc["title"])) {
                val l = layer as? Map<*, *> ?: continue
                val asset = (l["asset"] as? String ?: l["asset_id"]) as? String ?: continue
                if (l["kind"] == "background") images += BedrockImageLayer(asset, 0.0, null)
                val x = l["x"] as? Number
                val y = l["y"] as? Number
                if (l["kind"] == "glyph" && x != null && y != null) images += BedrockImageLayer(asset, x.toDouble(), y.toDouble())
            }

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
            val buttons = ArrayList<BedrockButton>()
            for (element in elements) {
                if (!Js.truthy(element)) continue
                val el = element as? Map<*, *> ?: continue
                if (Js.truthy(el["iterates"]) || Js.truthy(el["places"])) continue
                val apps = listOf<Any?>(el) + ((el["states"] as? List<*>) ?: emptyList())
                if (apps.none { Js.truthy((it as? Map<*, *>)?.get("image")) }) continue
                val slots = slotsOf(el["positions"], sizeInt) ?: continue
                val area = ImageButtonGeometry.area(slots, "chest", sizeInt, false) ?: continue
                if (buttons.size >= BedrockTitle.BUTTON_MAX) continue
                val buttonImages = ArrayList<BedrockButtonImage>()
                apps.forEachIndexed { state, app ->
                    val image = imageOf(app)
                    if (image != null && state < BedrockTitle.STATE_MAX) {
                        buttonImages += BedrockButtonImage(image.asset, image.fit, image.offsetX, image.offsetY, state)
                    }
                }
                buttons += BedrockButton(buttons.size, area.x, area.y, area.width * 18, area.height * 18, buttonImages)
            }

            out += BedrockMenu(
                projectId, id, BedrockTitle.menuKey(projectId, id, variant), rows,
                doc["vanilla_texture"] == false, images, textLayers(doc["title"]), buttons,
            )
        }
        return out
    }
}

/** `ui/chest_screen.json` (`bedrockUi.ts`): the vanilla chest screen, changed through JSON UI `modifications`. */
internal object BedrockUi {
    private const val BEDROCK_Y = 4
    private const val GRID_X = 7
    private const val GRID_Y = 21
    private const val CELL = 18
    private const val WIDTH = 176
    private const val LAYER_BACKGROUND = 30
    private const val LAYER_GRID = 31
    private const val LAYER_IMAGE = 32
    private const val LAYER_TEXT = 33
    private const val T = "\$artisan_title"
    private const val DEFAULT_COLOR = "#404040"

    private val NAMED_COLORS = mapOf(
        "black" to "#000000", "dark_blue" to "#0000aa", "dark_green" to "#00aa00", "dark_aqua" to "#00aaaa",
        "dark_red" to "#aa0000", "dark_purple" to "#aa00aa", "gold" to "#ffaa00", "gray" to "#aaaaaa",
        "dark_gray" to "#555555", "blue" to "#5555ff", "green" to "#55ff55", "aqua" to "#55ffff",
        "red" to "#ff5555", "light_purple" to "#ff55ff", "yellow" to "#ffff55", "white" to "#ffffff",
    )
    private val HEX = Regex("^#([0-9a-fA-F]{6})$")

    private fun contains(text: String) = "(not (($T - '$text') = $T))"

    private fun anyOf(conditions: List<String>) = if (conditions.size == 1) conditions[0] else "(${conditions.joinToString(" or ")})"

    private fun MutableMap<String, Any?>.whenVisible(condition: String): MutableMap<String, Any?> = apply {
        put(T, "\$container_title")
        put("visible", condition)
    }

    private fun hasKey(menu: BedrockMenu) = contains(BedrockTitle.MARKER + menu.key)

    /**
     * Bytes in front of the marker as the client may receive them: the proxy chain adds formatting
     * codes before the title (Geyser a `§r`; 12 bytes measured with Geyser on Velocity and
     * ViaVersion on Paper). A text label exists once per candidate and shows only where the marker
     * and key really start.
     */
    val LEAD_CANDIDATES = listOf(0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30)
    /** Bytes of the marker and the menu key. */
    private const val KEY_BYTES = 9
    /** A Bedrock label draws its text about a pixel lower than Java does. */
    private const val TEXT_DY = -1

    /** The marker and key of [menu] start at byte [lead] of the title. */
    private fun keyAt(menu: BedrockMenu, lead: Int): String {
        val head = "('%.${lead + KEY_BYTES}s' * $T)"
        val before = if (lead == 0) head else "($head - ('%.${lead}s' * $T))"
        return "($before = '${BedrockTitle.MARKER}${menu.key}')"
    }

    private fun field(menu: BedrockMenu, layer: BedrockTextLayer, lead: Int): String {
        val offset = lead + BedrockTitle.fieldOffset(menu.buttons.size, menu.texts.map { it.length }, layer.index)
        return "((('%.${layer.length}s' * ($T - ('%.${offset}s' * $T))) - '${BedrockTitle.PAD}') - '${BedrockTitle.PAD2}')"
    }

    fun labelColor(color: String?): List<Double> {
        val hex = color?.takeIf { it.isNotEmpty() }?.let { NAMED_COLORS[it] ?: it } ?: DEFAULT_COLOR
        val match = HEX.find(hex) ?: HEX.find(DEFAULT_COLOR)!!
        val n = match.groupValues[1].toInt(16)
        return listOf((n shr 16) and 255, (n shr 8) and 255, n and 255).map { jsRound(it / 255.0 * 1000) / 1000 }
    }

    private fun id(menu: BedrockMenu, what: String): String {
        val key = menu.key.codePoints().toArray().joinToString("") { it.toString(16) }
        return "artisan_${key}_$what"
    }

    fun backgroundTexture(menu: BedrockMenu) = "textures/artisan/menus/${id(menu, "bg")}"

    fun buttonTexture(key: String) = "textures/artisan/$key"

    private fun element(vararg pairs: Pair<String, Any?>): MutableMap<String, Any?> = linkedMapOf(*pairs)

    private fun backgroundElement(menu: BedrockMenu, height: Int): Map<String, Any?> = mapOf(
        id(menu, "bg") to element(
            "type" to "image",
            "texture" to backgroundTexture(menu),
            "size" to listOf(WIDTH, height),
            "offset" to listOf(0, BEDROCK_Y),
            "anchor_from" to "top_left",
            "anchor_to" to "top_left",
            "layer" to LAYER_BACKGROUND,
        ).whenVisible(hasKey(menu)),
    )

    private fun buttonElements(menu: BedrockMenu, textureKey: (BedrockButton, Int) -> String): List<Map<String, Any?>> {
        val out = ArrayList<Map<String, Any?>>()
        for (button in menu.buttons) {
            for (image in button.images) {
                out += mapOf(
                    id(menu, "b${button.index}_${image.state}") to element(
                        "type" to "image",
                        "texture" to buttonTexture(textureKey(button, image.state)),
                        "size" to listOf(button.width, button.height),
                        "offset" to listOf(button.x, button.y + BEDROCK_Y),
                        "anchor_from" to "top_left",
                        "anchor_to" to "top_left",
                        "layer" to LAYER_IMAGE,
                    ).whenVisible("(${hasKey(menu)} and ${contains(BedrockTitle.buttonPair(button.index, image.state))})"),
                )
            }
        }
        return out
    }

    /** A textarea's `x` is where its lines align, as on Java: their centre, or their right end. */
    private fun labelX(layer: BedrockTextLayer): Double {
        val width = layer.width ?: return layer.x
        return when (layer.alignment) {
            "center" -> layer.x - jsRound(width / 2)
            "right" -> layer.x - width
            else -> layer.x
        }
    }

    private fun textElements(menu: BedrockMenu): List<Map<String, Any?>> = menu.texts.flatMap { layer ->
        LEAD_CANDIDATES.map { lead -> textElement(menu, layer, lead) }
    }

    private fun textElement(menu: BedrockMenu, layer: BedrockTextLayer, lead: Int): Map<String, Any?> =
        mapOf(
            id(menu, "t${layer.index}_$lead") to element(
                "type" to "label",
                "text" to field(menu, layer, lead),
                "offset" to listOf(labelX(layer), layer.y + BEDROCK_Y + TEXT_DY),
                "anchor_from" to "top_left",
                "anchor_to" to "top_left",
                "size" to listOf(layer.width ?: "default", "default"),
                "text_alignment" to (layer.alignment ?: "left"),
                "color" to labelColor(layer.color),
                "font_scale_factor" to layer.scale,
                "shadow" to false,
                "layer" to LAYER_TEXT,
            ).whenVisible("(${hasKey(menu)} and ${keyAt(menu, lead)})"),
        )

    private fun chestPanel(panel: String, visible: String): Map<String, Any?> = mapOf(
        "chest_panel" to element("type" to "panel", "layer" to 5).whenVisible(visible).apply {
            put(
                "controls",
                listOf(
                    mapOf("${panel}_chest_panel_top_half@chest.${panel}_chest_panel_top_half" to emptyMap<String, Any?>()),
                    mapOf("inventory_panel_bottom_half_with_label@common.inventory_panel_bottom_half_with_label" to emptyMap<String, Any?>()),
                    mapOf("hotbar_grid@common.hotbar_grid_template" to emptyMap<String, Any?>()),
                    mapOf("inventory_take_progress_icon_button@common.inventory_take_progress_icon_button" to emptyMap<String, Any?>()),
                    mapOf("flying_item_renderer@common.flying_item_renderer" to mapOf("layer" to 15)),
                ),
            )
        },
    )

    fun chestScreen(
        menus: List<BedrockMenu>,
        backgroundHeight: (BedrockMenu) -> Int,
        buttonKey: (BedrockMenu, BedrockButton, Int) -> String,
    ): Map<String, Any?> {
        val screen = element(
            "namespace" to "chest",
            "artisan_grid_item@common.container_item" to element(
                "\$item_collection_name" to "container_items",
                "\$background_images" to "common.empty_panel",
                "\$item_renderer_size" to listOf(CELL, CELL),
            ),
        )
        for ((rows, panel) in listOf(3 to "small", 6 to "large")) {
            val here = menus.filter { it.rows == rows }
            if (here.isEmpty()) continue
            val styled = anyOf(here.map(::hasKey))
            val transparent = here.filter { it.transparent }
            val modifications = ArrayList<Map<String, Any?>>()
            if (transparent.isNotEmpty()) {
                val visible = "(not ${anyOf(transparent.map(::hasKey))})"
                modifications += element(
                    "array_name" to "controls",
                    "operation" to "replace",
                    "control_name" to "common_panel",
                    "value" to mapOf("common_panel@common.common_panel" to element().whenVisible(visible)),
                )
                modifications += element(
                    "array_name" to "controls",
                    "operation" to "replace",
                    "control_name" to "chest_panel",
                    "value" to chestPanel(panel, visible),
                )
            }
            val value = ArrayList<Map<String, Any?>>()
            here.forEach { value += backgroundElement(it, backgroundHeight(it)) }
            value += mapOf(
                "artisan_chest_grid@chest.${panel}_chest_grid" to element(
                    "offset" to listOf(GRID_X, GRID_Y),
                    "grid_item_template" to "chest.artisan_grid_item",
                    "layer" to LAYER_GRID,
                ).whenVisible(styled),
            )
            here.forEach { menu -> value += buttonElements(menu) { b, s -> buttonKey(menu, b, s) } }
            here.forEach { value += textElements(it) }
            modifications += element("array_name" to "controls", "operation" to "insert_back", "value" to value)
            screen["${panel}_chest_panel/root_panel"] = mapOf("modifications" to modifications)
        }
        return screen
    }
}

class BedrockPackResult(val zip: ByteArray, val sha1: String)

/** The `.mcpack` itself (`bedrockPack.ts`): its uuid from the server id, its version from its content. */
internal object BedrockPack {
    private const val WIDTH = 176
    private const val TITLE_H = 17
    private const val ROW_H = 18
    private const val GLYPH_Y_BASE = 13

    private fun u(b: Byte) = b.toInt() and 0xff

    /** `src` composited over `dst` at (dx, dy), straight alpha. */
    private fun blend(src: RgbaImage, dst: RgbaImage, dx: Int, dy: Int) {
        for (y in 0 until src.height) {
            val ty = y + dy
            if (ty < 0 || ty >= dst.height) continue
            for (x in 0 until src.width) {
                val tx = x + dx
                if (tx < 0 || tx >= dst.width) continue
                val s = (y * src.width + x) * 4
                val d = (ty * dst.width + tx) * 4
                val sa = u(src.data[s + 3]) / 255.0
                if (sa == 0.0) continue
                val da = u(dst.data[d + 3]) / 255.0
                val oa = sa + da * (1 - sa)
                for (c in 0 until 3) {
                    val sv = u(src.data[s + c]).toDouble()
                    val dv = u(dst.data[d + c]).toDouble()
                    dst.data[d + c] = jsRound((sv * sa + dv * da * (1 - sa)) / oa).toInt().toByte()
                }
                dst.data[d + 3] = jsRound(oa * 255).toInt().toByte()
            }
        }
    }

    private fun scaleOf(png: RgbaImage): Int =
        if (png.width == png.height && png.width >= 256 && png.width % 256 == 0) png.width / 256 else 1

    /** The top of the vanilla chest window (title bar and slot rows), at 1x. */
    private fun chestTop(texture: ByteArray, rows: Int): RgbaImage {
        val src = Png.decode(texture)
        val k = scaleOf(src)
        val h = TITLE_H + rows * ROW_H
        val out = RgbaImage(WIDTH, h)
        if (k == 1) {
            Png.bitblt(src, out, 0, 0, WIDTH, h, 0, 0)
            return out
        }
        // An HD texture: nearest-neighbour down to the pack's pixel grid.
        for (y in 0 until h) for (x in 0 until WIDTH) {
            System.arraycopy(src.data, (y * k * src.width + x * k) * 4, out.data, (y * WIDTH + x) * 4, 4)
        }
        return out
    }

    private class Placed(val image: RgbaImage, val x: Int, val y: Int)

    private fun placedImages(menu: BedrockMenu, pngs: Map<String, ByteArray>, assets: List<AssetRow>): List<Placed> {
        val out = ArrayList<Placed>()
        for (layer in menu.images) {
            val bytes = pngs[layer.asset] ?: continue
            val image = runCatching { Png.decode(bytes) }.getOrNull() ?: continue
            val row = assets.firstOrNull { it.id == layer.asset }
            // A background sits at its asset's ascent; a glyph at its own Y, floored like the Java pack.
            val y = if (layer.y == null) GLYPH_Y_BASE - (row?.ascent ?: (GLYPH_Y_BASE - TITLE_H).toDouble())
            else maxOf(layer.y, (GLYPH_Y_BASE - image.height).toDouble())
            out += Placed(image, layer.x.toInt(), y.toInt())
        }
        return out
    }

    private fun composeBackground(menu: BedrockMenu, pngs: Map<String, ByteArray>, assets: List<AssetRow>, chest: ByteArray): RgbaImage {
        val layers = placedImages(menu, pngs, assets)
        val top = if (menu.transparent) null else chestTop(chest, menu.rows)
        val height = maxOf(1, top?.height ?: 0, layers.maxOfOrNull { it.y + it.image.height } ?: 0)
        val out = RgbaImage(WIDTH, height)
        if (top != null) Png.bitblt(top, out, 0, 0, top.width, top.height, 0, 0)
        for (l in layers) blend(l.image, out, l.x, l.y)
        return out
    }

    private fun placement(button: BedrockButton, state: Int): ImageButtonPlacement {
        val image = button.images.first { it.state == state }
        return ImageButtonPlacement(image.asset, image.fit, image.offsetX, image.offsetY, button.width, button.height, button.y)
    }

    private fun uuidOf(seed: String): String {
        val h = sha256Hex(seed.toByteArray(Charsets.UTF_8))
        return "${h.substring(0, 8)}-${h.substring(8, 12)}-4${h.substring(13, 16)}-8${h.substring(17, 20)}-${h.substring(20, 32)}"
    }

    fun build(serverId: String, menus: List<BedrockMenu>, pngs: Map<String, ByteArray>, assets: List<AssetRow>, chest: ByteArray): BedrockPackResult {
        val files = LinkedHashMap<String, ByteArray>()
        val backgrounds = HashMap<String, RgbaImage>()
        for (menu in menus) {
            val png = composeBackground(menu, pngs, assets, chest)
            backgrounds[menu.key] = png
            files["${BedrockUi.backgroundTexture(menu)}.png"] = Png.encode(png)
        }
        val buttonKeys = HashMap<String, String>()
        val keyOf = { menu: BedrockMenu, button: BedrockButton, state: Int ->
            buttonKeys.getOrPut("${menu.key}/${button.index}/$state") {
                val placed = placement(button, state)
                val key = ImageButtons.key(placed)
                val path = "${BedrockUi.buttonTexture(key)}.png"
                val source = pngs[placed.asset]
                if (!files.containsKey(path) && source != null) {
                    // An unreadable PNG: the Java pack skips it the same way.
                    runCatching { Png.encode(ImageButtons.render(Png.decode(source), placed).first) }.getOrNull()?.let { files[path] = it }
                }
                key
            }
        }
        // Buttons whose image is missing keep their element: Bedrock then shows nothing there.
        val shown = menus.map { menu ->
            menu.withButtons(menu.buttons.map { b -> BedrockButton(b.index, b.x, b.y, b.width, b.height, b.images.filter { pngs.containsKey(it.asset) }) })
        }
        val screen = BedrockUi.chestScreen(shown, { backgrounds.getValue(it.key).height }, keyOf)
        files["ui/chest_screen.json"] = Js.stringifyBytes(screen, 2)
        files["textures/item_texture.json"] = Js.stringifyBytes(
            mapOf(
                "resource_pack_name" to "artisan",
                "texture_name" to "atlas.items",
                "texture_data" to mapOf("artisan_hit_area" to mapOf("textures" to listOf("textures/items/artisan_hit_area"))),
            ),
            2,
        )
        files["textures/items/artisan_hit_area.png"] = Png.encode(RgbaImage(16, 16))
        files["font/glyph_F8.png"] = Png.encode(RgbaImage(256, 256))

        val all = java.io.ByteArrayOutputStream()
        for (path in files.keys.sorted()) {
            all.write(path.toByteArray(Charsets.UTF_8))
            all.write(files.getValue(path))
        }
        val digest = sha256Hex(all.toByteArray())
        val version = listOf(1, digest.substring(0, 4).toInt(16), digest.substring(4, 8).toInt(16))
        files["manifest.json"] = Js.stringifyBytes(
            mapOf(
                "format_version" to 2,
                "header" to linkedMapOf(
                    "name" to "Artisan menus",
                    "description" to "Menus styled by Artisan, for Bedrock players",
                    "uuid" to uuidOf("artisan-bedrock:$serverId"),
                    "version" to version,
                    "min_engine_version" to listOf(1, 20, 0),
                ),
                "modules" to listOf(linkedMapOf("type" to "resources", "uuid" to uuidOf("artisan-bedrock-module:$serverId"), "version" to version)),
            ),
            2,
        )
        val zip = Zip.write(files)
        return BedrockPackResult(zip, sha1Hex(zip))
    }
}
