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
    /** Fallback run when `requirements` fail: a step tree (structured wire). */
    val fallback: List<Step>,
    val cooldown: Cooldown? = null,
    /** Canonical menu/v1 tree. Non-empty = takes precedence over `actions` (legacy wire). */
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
    /**
     * Canonical i18n ADDRESS of this appearance — `menus.<m>.elements.<el>.<state>`,
     * mirroring the editor's key-site visitor. Inline mode keeps the default
     * language's text literally in the menu file and puts the other languages in
     * `lang/<lang>.yaml` under `<i18nBase>.title` / `.lore`; without this the
     * literal would be untranslatable. Empty only for appearances compiled
     * outside a menu.
     */
    val i18nBase: String = "",
)
