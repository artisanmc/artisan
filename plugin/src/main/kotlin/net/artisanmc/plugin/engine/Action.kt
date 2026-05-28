package net.artisanmc.plugin.engine

sealed class Action {
    data class RunCommand(val command: String, val asConsole: Boolean = false) : Action()
    data class OpenMenu(
        val menuId: String,
        val context: Map<String, String> = emptyMap(),
        val clearContext: Boolean = false,
    ) : Action()
    data object CloseMenu : Action()
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
    data class SendMessage(val text: String) : Action()
    data class Broadcast(val text: String) : Action()
    data class ShowTitle(
        val title:    String,
        val subtitle: String? = null,
        val fadeIn:   Int = 10,
        val stay:     Int = 70,
        val fadeOut:  Int = 20,
    ) : Action()
    data class PlaySound(val sound: String, val volume: Float = 1f, val pitch: Float = 1f) : Action()
    data class Teleport(
        val world: String? = null,
        val x: Double = 0.0,
        val y: Double = 0.0,
        val z: Double = 0.0,
        val yaw: Float = 0f,
        val pitch: Float = 0f,
        val warpName: String? = null,
    ) : Action()
    data class PaginationNext(val elementId: String? = null) : Action()
    data class PaginationPrev(val elementId: String? = null) : Action()
    data class OpenDialog(
        val dialogId: String,
        val context: Map<String, String> = emptyMap(),
        val clearContext: Boolean = false,
    ) : Action()
    data object CloseDialog : Action()
}
