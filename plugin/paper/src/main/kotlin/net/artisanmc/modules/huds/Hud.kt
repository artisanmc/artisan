package net.artisanmc.modules.huds

import net.artisanmc.modules.api.text.OverlayApi
import net.artisanmc.modules.api.text.OverlayLayout

/**
 * One `huds/<id>.yaml` (`schema: hud/v1`, ADR `server-huds` §1), as the runtime draws it: the slot
 * it goes to, its priority there, how often it is checked again, its conditions, its layout and the
 * template of each named text layer. The conditions stay in their wire form (compiled at each test).
 *
 * @property ref the qualified id `project/id`: the layer's name in the slot and what `show_hud` names.
 * @property problems what was left out of the file, each `path: detail`, reported once at load.
 */
internal data class Hud(
    val projectId: String,
    val id: String,
    val enabled: Boolean,
    val slot: OverlayApi.Slot,
    val priority: Int,
    val refresh: Int,
    val conditions: List<Any?>,
    val layout: OverlayLayout,
    val texts: Map<String, String>,
    val problems: List<String>,
) {
    val ref: String get() = "$projectId/$id"

    /** The layer's name in its slot: never collides with a module's (`<module>:<layer>`). */
    val layer: String get() = "artisan:hud/$ref"

    /** The named text layers, in drawing order. */
    val textLayers: List<OverlayLayout.Text> get() = layout.layers.filterIsInstance<OverlayLayout.Text>()

    companion object {
        const val KIND = "hud"
        const val DIR = "huds"
        const val SCHEMA = "hud/v1"

        const val DEFAULT_PRIORITY = 100
        const val DEFAULT_REFRESH = 20
        /** Bounds of `refresh` other than 0 (ADR `server-huds` §1, open question). */
        const val MIN_REFRESH = 5
        const val MAX_REFRESH = 1200

        /**
         * The HUD of a raw Document ([net.artisanmc.modules.api.project.ProjectContentApi.documents]),
         * or the reason it cannot be drawn. Tolerant like the rest of the runtime: an unknown key is
         * ignored; a wrong `slot`, `priority` or `refresh` takes its default and is reported; a
         * `list` or `image_slot` layer is left out and reported (filled by code, frame by frame: the
         * tool of a module drawing through `OverlayApi`).
         */
        fun parse(projectId: String, doc: Map<String, Any?>): Result<Hud> {
            val id = doc["id"]?.toString().orEmpty()
            if (id.isEmpty()) return Result.failure(IllegalArgumentException("$projectId: a HUD without an id"))
            val problems = mutableListOf<String>()

            val enabled = when (val e = doc["enabled"]) {
                null -> true
                is Boolean -> e
                else -> e.toString().trim().lowercase() != "false"
            }
            val slot = when (val s = doc["slot"]?.toString()?.trim()?.lowercase()) {
                null, "", "boss_bar" -> OverlayApi.Slot.BOSS_BAR
                "action_bar" -> OverlayApi.Slot.ACTION_BAR
                else -> OverlayApi.Slot.BOSS_BAR.also { problems += "slot: unknown slot '$s', boss_bar used" }
            }
            val priority = int(doc["priority"]) ?: DEFAULT_PRIORITY.also {
                if (doc["priority"] != null) problems += "priority: not a number, $DEFAULT_PRIORITY used"
            }
            val refresh = when (val r = doc["refresh"]) {
                null -> DEFAULT_REFRESH
                else -> when (val n = int(r)) {
                    null -> DEFAULT_REFRESH.also { problems += "refresh: not a number, $DEFAULT_REFRESH used" }
                    0 -> 0
                    else -> n.coerceIn(MIN_REFRESH, MAX_REFRESH).also {
                        if (it != n) problems += "refresh: $n is out of $MIN_REFRESH..$MAX_REFRESH, $it used"
                    }
                }
            }
            val conditions = when (val c = doc["when"]) {
                null -> emptyList()
                is List<*> -> c
                else -> listOf(c)
            }

            val read = OverlayLayout.read(doc["layout"])
            read.problems.forEach { problems += "${it.path}: ${it.detail}" }
            val layers = read.layout.layers.filterIndexed { i, layer ->
                val kept = layer is OverlayLayout.Image || layer is OverlayLayout.Text
                if (!kept) problems += "layout[$i]: a ${kindOf(layer)} layer is drawn by a module's code, not by a HUD"
                kept
            }

            val raw = doc["texts"] as? Map<*, *> ?: emptyMap<Any?, Any?>()
            val texts = buildMap {
                for (layer in layers) {
                    if (layer !is OverlayLayout.Text) continue
                    val value = raw[layer.slot]
                    put(layer.slot, if (value is String) value else value?.toString().orEmpty())
                }
            }
            return Result.success(
                Hud(projectId, id, enabled, slot, priority, refresh, conditions, OverlayLayout(layers), texts, problems),
            )
        }

        /**
         * What a HUD's file asks of the pack: each `image` layer where the layout draws it. Twin of
         * `hudPackImages` (`editor/src/modules/huds/hud.ts`): same images, same order.
         */
        fun packImages(doc: Map<String, Any?>): List<OverlayLayout.PackImage> =
            OverlayLayout(OverlayLayout.read(doc["layout"]).layout.layers.filterIsInstance<OverlayLayout.Image>()).packImages

        private fun int(value: Any?): Int? = when (value) {
            is Number -> value.toInt()
            is String -> value.trim().toIntOrNull()
            else -> null
        }

        private fun kindOf(layer: OverlayLayout.Layer): String = when (layer) {
            is OverlayLayout.ImageSlot -> "image_slot"
            is OverlayLayout.Rows -> "list"
            else -> layer.javaClass.simpleName.lowercase()
        }
    }
}
