package net.artisanmc.plugin.render

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
        fun of(menu: MenuYaml, element: ElementYaml): ImageButtonLayout? {
            if (element.iterates != null || element.places != null) return null
            val slots = parsePositions(element.positionsSpec, menu.size).sorted()
            if (slots.isEmpty()) return null
            val cols = when (menu.inventoryType) { "hopper" -> 5; "dropper" -> 3; else -> 9 }
            val left = slots.minOf { it % cols }; val right = slots.maxOf { it % cols }
            val top = slots.first() / cols; val bottom = slots.last() / cols
            if (slots.size != (right - left + 1) * (bottom - top + 1)) return null
            if (menu.allElements.any { other -> other.id != element.id &&
                (parsePositions(other.positionsSpec, menu.size) + (other.places?.placements?.map { it.position } ?: emptyList())).any { it in slots } }) return null
            val originX = when (cols) { 5 -> 43; 3 -> 61; else -> 7 }
            val originY = when (cols) { 5 -> 19; 3 -> 16; else -> 17 }
            return ImageButtonLayout(slots, originX + left * 18, originY + top * 18, (right - left + 1) * 18, (bottom - top + 1) * 18)
        }
    }
}
