package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.LocalizedText

object ActionParser {

    @Suppress("UNCHECKED_CAST")
    fun parse(raw: Map<String, Any>): Action {
        val type = raw["type"]?.toString()
            ?: throw IllegalArgumentException("Action missing 'type' field: $raw")
        return when (type) {
            "run_command"    -> Action.RunCommand(
                command   = str(raw, "command"),
                asConsole = raw["as"]?.toString() == "console"
                         || raw["as_console"] as? Boolean == true,
            )
            "open_menu"      -> Action.OpenMenu(
                menuId       = str(raw, "menu_id"),
                context      = (raw["context"] as? Map<String, Any>)?.mapValues { it.value.toString() } ?: emptyMap(),
                clearContext = raw["clear_context"] as? Boolean ?: false,
            )
            "close_menu"     -> Action.CloseMenu
            "open_previous_menu" -> Action.OpenPreviousMenu
            "give_item"      -> Action.GiveItem(
                material = str(raw, "material"),
                count    = (raw["count"] as? Number)?.toInt() ?: 1,
                name     = raw["name"] as? String,
                lore     = (raw["lore"] as? List<*>)?.map { it.toString() } ?: emptyList(),
            )
            "take_item"      -> Action.TakeItem(str(raw, "material"), (raw["count"] as? Number)?.toInt() ?: 1)
            "give_money"     -> Action.GiveMoney((raw["amount"] as Number).toDouble(), raw["currency"] as? String)
            "take_money"     -> Action.TakeMoney((raw["amount"] as Number).toDouble(), raw["currency"] as? String)
            "give_xp"        -> Action.GiveXp((raw["amount"] as Number).toInt())
            "give_level"     -> Action.GiveLevel((raw["amount"] as Number).toInt())
            "send_message"   -> Action.SendMessage(LocalizedText.of(str(raw, "text")))
            "broadcast"      -> Action.Broadcast(LocalizedText.of(str(raw, "text")))
            "show_title"     -> Action.ShowTitle(
                title    = LocalizedText.of(str(raw, "title")),
                subtitle = (raw["subtitle"] as? String)?.let(LocalizedText::of),
                fadeIn   = (raw["fade_in"]  as? Number)?.toInt() ?: 10,
                stay     = (raw["stay"]     as? Number)?.toInt() ?: 70,
                fadeOut  = (raw["fade_out"] as? Number)?.toInt() ?: 20,
            )
            "play_sound"     -> Action.PlaySound(
                sound  = str(raw, "sound"),
                volume = (raw["volume"] as? Number)?.toFloat() ?: 1f,
                pitch  = (raw["pitch"] as? Number)?.toFloat() ?: 1f,
            )
            "teleport"       -> Action.Teleport(
                world    = raw["world"] as? String,
                x        = (raw["x"] as? Number)?.toDouble() ?: 0.0,
                y        = (raw["y"] as? Number)?.toDouble() ?: 0.0,
                z        = (raw["z"] as? Number)?.toDouble() ?: 0.0,
                yaw      = (raw["yaw"] as? Number)?.toFloat() ?: 0f,
                pitch    = (raw["pitch"] as? Number)?.toFloat() ?: 0f,
            )
            "pagination_next" -> Action.PaginationNext(raw["element_id"] as? String)
            "pagination_prev" -> Action.PaginationPrev(raw["element_id"] as? String)
            "open_dialog"    -> Action.OpenDialog(
                dialogId     = str(raw, "dialog_id"),
                context      = (raw["context"] as? Map<*, *>)
                                   ?.mapKeys { it.key.toString() }
                                   ?.mapValues { it.value.toString() } ?: emptyMap(),
                clearContext = raw["clear_context"] as? Boolean ?: false,
            )
            "close_dialog"   -> Action.CloseDialog
            "set_arg"            -> Action.SetArg(str(raw, "arg"), str(raw, "value"))
            "set_arg_cycle_next" -> Action.SetArgCycleNext(str(raw, "arg"), str(raw, "list"))
            "set_arg_cycle_prev" -> Action.SetArgCyclePrev(str(raw, "arg"), str(raw, "list"))
            "run_actions"        -> Action.RunActions(str(raw, "actions"))
            else             -> throw IllegalArgumentException("Unknown action type: $type")
        }
    }

    private fun str(raw: Map<String, Any>, key: String): String =
        raw[key]?.toString() ?: throw IllegalArgumentException("Action missing required field '$key': $raw")
}
