package net.artisanmc.plugin.render.menu

import net.artisanmc.plugin.session.MenuSlots
import net.artisanmc.plugin.session.PlayerInventoryMode
import net.artisanmc.plugin.model.ElementYaml
import net.artisanmc.plugin.model.ImageButtonYaml
import net.artisanmc.plugin.model.LabelYaml
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.engine.MenuTitleParser
import net.artisanmc.plugin.model.MenuYaml
import java.security.MessageDigest

data class ImageButtonLayout(val slots: List<Int>, val x: Int, val y: Int, val width: Int, val height: Int) {
    /** [asset]: the pack id of the image, which is its name unless its module is not the first to hold one ([MenuImages]). */
    fun assetKey(image: ImageButtonYaml, asset: String = image.asset): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(asset.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        val offsets = if (image.offsetX != 0 || image.offsetY != 0) "_${image.offsetX}_${image.offsetY}" else ""
        val anchor = if (image.anchor != "center") "_${image.anchor}" else ""
        return "buttons/${hash}_${width}_${height}_${image.fit}_${y}${offsets}${anchor}"
    }

    /** Mirror of `labelFrame` (docs/schema/menu/v1/imageButtonGeometry.ts): the title text of [label] in this rectangle. */
    fun labelLayer(label: LabelYaml): MenuTitleLayer.Textarea {
        val size = MenuTitleParser.parseSize(label.size)
        val alignment = MenuTitleParser.parseAlignment(label.align.ifBlank { "center" })
        val left = when (alignment) {
            MenuTitleLayer.Alignment.LEFT -> x + LABEL_INSET
            MenuTitleLayer.Alignment.CENTER -> x + width / 2
            MenuTitleLayer.Alignment.RIGHT -> x + width - LABEL_INSET
        }
        // A line of the bitmap font is 7 px high at size 8 (its descender row stays below).
        val cap = LABEL_CAP_HEIGHT * size / 8
        val top = when (label.valign) {
            "top" -> y + LABEL_INSET
            "bottom" -> y + height - cap - LABEL_INSET
            else -> y + (height - cap) / 2
        }
        return MenuTitleLayer.Textarea(
            value = MenuTitleParser.parseLText(label.text),
            x = left + label.offsetX, y = top + label.offsetY,
            width = width, lineHeight = size + 2, alignment = alignment, size = size,
        )
    }

    companion object {
        private const val LABEL_INSET = 2
        private const val LABEL_CAP_HEIGHT = 7

        private fun parsePositions(spec: String, size: Int): List<Int> {
            if (spec.isBlank()) return emptyList()
            val slots = sortedSetOf<Int>()
            for (part in spec.split(',')) {
                val match = Regex("\\s*(\\d+)(?:\\s*-\\s*(\\d+))?\\s*").matchEntire(part) ?: return emptyList()
                val a = match.groupValues[1].toIntOrNull() ?: return emptyList()
                val b = match.groupValues[2].takeIf { it.isNotBlank() }?.toIntOrNull() ?: a
                if (a !in 0 until size || b !in 0 until size) return emptyList()
                slots.addAll(minOf(a, b)..maxOf(a, b))
            }
            return slots.toList()
        }
        private data class Cell(val section: Int, val col: Int, val row: Int, val x: Int, val y: Int)

        /**
         * Mirror of `imageButtonArea` (docs/schema/menu/v1/imageButtonGeometry.ts):
         * raw slot → section (menu grid, inventory rows, hotbar), column, row and
         * section origin in MC pixels. Player slots only with a hidden bottom.
         */
        private fun cell(slot: Int, type: String, size: Int): Cell {
            if (slot < size) {
                val (cols, x, y) = when (type) { "hopper" -> Triple(5, 43, 19); "dropper" -> Triple(3, 61, 16); else -> Triple(9, 7, 17) }
                return Cell(0, slot % cols, slot / cols, x, y)
            }
            val j = slot - size
            val top = when (type) { "hopper" -> 50; "dropper" -> 83; else -> 30 + (size / 9) * 18 }
            return if (j < 27) Cell(1, j % 9, j / 9, 7, top) else Cell(2, j - 27, 0, 7, top + 58)
        }

        /**
         * One slot of a row-bound element (iterates/places) as an 18×18 image area: each
         * row shows its own image there. Null for a slot outside the window.
         */
        fun slot(menu: MenuYaml, slot: Int): ImageButtonLayout? {
            val hidden = PlayerInventoryMode.parse(menu.playerInventory) == PlayerInventoryMode.HIDDEN
            val limit = menu.size + if (hidden) MenuSlots.PLAYER_SLOTS else 0
            if (slot !in 0 until limit) return null
            val c = cell(slot, menu.inventoryType, menu.size)
            return ImageButtonLayout(listOf(slot), c.x + c.col * 18, c.y + c.row * 18, 18, 18)
        }

        /** [rectangle], when no other element shares a slot with it. */
        fun of(menu: MenuYaml, element: ElementYaml): ImageButtonLayout? {
            val layout = rectangle(menu, element) ?: return null
            val hidden = PlayerInventoryMode.parse(menu.playerInventory) == PlayerInventoryMode.HIDDEN
            val limit = menu.size + if (hidden) MenuSlots.PLAYER_SLOTS else 0
            if (menu.allElements.any { other -> other.id != element.id &&
                (parsePositions(other.positionsSpec, limit) + (other.places?.placements?.map { it.position } ?: emptyList())).any { it in layout.slots } }) return null
            return layout
        }

        /** The rectangle of slots an element covers, as `imageButtonArea` computes it; null when its slots form none. */
        fun rectangle(menu: MenuYaml, element: ElementYaml): ImageButtonLayout? {
            if (element.iterates != null || element.places != null) return null
            val hidden = PlayerInventoryMode.parse(menu.playerInventory) == PlayerInventoryMode.HIDDEN
            val limit = menu.size + if (hidden) MenuSlots.PLAYER_SLOTS else 0
            val slots = parsePositions(element.positionsSpec, limit).sorted()
            if (slots.isEmpty()) return null
            val cells = slots.map { cell(it, menu.inventoryType, menu.size) }
            if (cells.any { it.section != cells.first().section }) return null
            val left = cells.minOf { it.col }; val right = cells.maxOf { it.col }
            val top = cells.minOf { it.row }; val bottom = cells.maxOf { it.row }
            if (slots.size != (right - left + 1) * (bottom - top + 1)) return null
            val origin = cells.first()
            return ImageButtonLayout(slots, origin.x + left * 18, origin.y + top * 18, (right - left + 1) * 18, (bottom - top + 1) * 18)
        }
    }
}
