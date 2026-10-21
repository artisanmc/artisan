package net.artisanmc.plugin.render.menu

import net.artisanmc.plugin.session.MenuSlots
import net.artisanmc.plugin.session.PlayerInventoryMode
import net.artisanmc.plugin.model.ElementYaml
import net.artisanmc.plugin.model.ImageButtonYaml
import net.artisanmc.plugin.model.MenuYaml
import java.security.MessageDigest

data class ImageButtonLayout(val slots: List<Int>, val x: Int, val y: Int, val width: Int, val height: Int) {
    fun assetKey(image: ImageButtonYaml): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(image.asset.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        val offsets = if (image.offsetX != 0 || image.offsetY != 0) "_${image.offsetX}_${image.offsetY}" else ""
        return "buttons/${hash}_${width}_${height}_${image.fit}_${y}${offsets}"
    }

    companion object {
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
