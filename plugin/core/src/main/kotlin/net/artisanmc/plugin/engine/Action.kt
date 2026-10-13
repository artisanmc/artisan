package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.LocalizedText

sealed class Action {
    data class RunCommand(val command: String, val asConsole: Boolean = false) : Action()
    data class OpenMenu(
        val menuId: String,
        val context: Map<String, String> = emptyMap(),
        val clearContext: Boolean = false,
    ) : Action()
    data object CloseMenu : Action()
    /**
     * Re-opens the previous screen from the player's navigation history (the
     * back button). Consumes the history — see [NavigationHistoryStore].
     */
    data object OpenPreviousMenu : Action()
    data class GiveItem(
        val material: String,
        val count: Int = 1,
        val name: String? = null,
        val lore: List<String> = emptyList(),
    ) : Action()
    data class TakeItem(val material: String, val count: Int = 1) : Action()
    data class GiveMoney(val amount: Double, val currency: String? = null) : Action()
    data class TakeMoney(val amount: Double, val currency: String? = null) : Action()
    data class GiveXp(val amount: Int) : Action()
    data class GiveLevel(val amount: Int) : Action()
    /**
     * Text is a [LocalizedText] (ADR structured-action-wire / field-local): a
     * literal/ref string or a `{lang: text}` map. `i18n` is the legacy canonical
     * ADDRESS (inline mode); see [assignI18nAddresses].
     */
    data class SendMessage(val text: LocalizedText, val i18n: String? = null) : Action() {
        /** Convenience for a single string literal (tests, DSL bridge). */
        constructor(text: String) : this(LocalizedText.of(text))
    }
    data class Broadcast(val text: LocalizedText, val i18n: String? = null) : Action() {
        constructor(text: String) : this(LocalizedText.of(text))
    }
    data class ShowTitle(
        val title:    LocalizedText,
        val subtitle: LocalizedText? = null,
        val fadeIn:   Int = 10,
        val stay:     Int = 70,
        val fadeOut:  Int = 20,
        val i18nTitle:    String? = null,
        val i18nSubtitle: String? = null,
    ) : Action() {
        constructor(
            title: String,
            subtitle: String? = null,
            fadeIn: Int = 10,
            stay: Int = 70,
            fadeOut: Int = 20,
        ) : this(LocalizedText.of(title), subtitle?.let(LocalizedText::of), fadeIn, stay, fadeOut)
    }
    data class PlaySound(val sound: String, val volume: Float = 1f, val pitch: Float = 1f) : Action()
    data class Teleport(
        val world: String? = null,
        val x: Double = 0.0,
        val y: Double = 0.0,
        val z: Double = 0.0,
        val yaw: Float = 0f,
        val pitch: Float = 0f,
    ) : Action()
    data class PaginationNext(val elementId: String? = null) : Action()
    data class PaginationPrev(val elementId: String? = null) : Action()
    data class OpenDialog(
        val dialogId: String,
        val context: Map<String, String> = emptyMap(),
        val clearContext: Boolean = false,
    ) : Action()
    data object CloseDialog : Action()
    data class SetArg(val arg: String, val value: String) : Action()
    /** `list` is the comma-separated value list ("price,name"). */
    data class SetArgCycleNext(val arg: String, val list: String) : Action()
    data class SetArgCyclePrev(val arg: String, val list: String) : Action()
    /**
     * Runs the action chain (DSL) carried by the source value [actions] (a scope
     * expression, e.g. `item.on_buy`). See ADR action-dsl §run_actions.
     */
    data class RunActions(val actions: String) : Action()
}
