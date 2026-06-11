package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.AppearanceYaml

data class Cooldown(
    val id: String,
    val durationSeconds: Long,
    val scope: String = "player",
    val message: String? = null,
)

data class ClickHandler(
    val requirements: List<Condition>,
    val actions: List<Action>,
    val fallback: List<Action>,
    val cooldown: Cooldown? = null,
    /** Arbre canonique menu/v1. Non-vide = prioritaire sur `actions` (wire legacy). */
    val steps: List<Step> = emptyList(),
)

enum class ClickType {
    LEFT, RIGHT, SHIFT_LEFT, SHIFT_RIGHT, MIDDLE;
    companion object {
        fun fromYamlKey(key: String): ClickType? = when (key.lowercase()) {
            "left"        -> LEFT
            "right"       -> RIGHT
            "shift_left"  -> SHIFT_LEFT
            "shift_right" -> SHIFT_RIGHT
            "middle"      -> MIDDLE
            else          -> null
        }
    }
}

data class CompiledAppearance(
    val conditions: List<Condition>,
    val clicks: Map<ClickType, ClickHandler>,
    val yaml: AppearanceYaml,
)
