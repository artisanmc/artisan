package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.LocalizedText

/**
 * Parser for the **name-keyed structured** action wire (ADR `structured-action-wire`).
 * An action is `{ <name>: args }`, a condition `{ <name>: args }`; `if` is a list
 * (implicit AND), `or:`/`and:` a list, `not:` a condition; text is a [LocalizedText].
 *
 * Tolerant read: a **string** handler is the old Action DSL; a `{steps: "<dsl>"}`
 * object is the legacy wrapped form; a **string list entry** is an action without
 * arguments. The parser never throws: an invalid entry is ignored, like the rest of
 * the bundle loader.
 */
object KeyedStepParser {

    /**
     * Parse a **keyed** wire (map = single step, list = steps). A string is an action
     * without arguments (for list entries, not a whole handler: a string handler is
     * the old DSL, see [ActionChainCompiler]).
     */
    fun parseKeyed(raw: Any?): List<Step> = when (raw) {
        null -> emptyList()
        is List<*> -> raw.mapNotNull { parseStep(it) }
        is Map<*, *> -> listOfNotNull(parseStep(raw))
        is String -> listOfNotNull(parseStep(raw))
        else -> emptyList()
    }

    private fun parseStep(raw: Any?): Step? = when {
        raw is String -> Step.ActionStep(parseNoArg(raw))
        raw is Map<*, *> ->
            if (raw.containsKey("if")) parseIf(raw)
            else singleEntry(raw)?.let { (name, value) -> Step.ActionStep(parseAction(name, value)) }
        else -> null
    }

    private fun parseIf(root: Map<*, *>): Step {
        var node: Map<*, *> = root
        val cases = mutableListOf<IfCase>()
        var elseSteps: List<Step> = emptyList()
        var guard = 0
        while (guard++ < 64) {
            cases += IfCase(
                conditions = asList(node["if"]).mapNotNull { parseCondition(it) },
                steps = asList(node["do"]).mapNotNull { parseStep(it) },
            )
            val els = asList(node["else"])
            val first = els.firstOrNull()
            if (els.size == 1 && first is Map<*, *> && first.containsKey("if")) {
                node = first
                continue
            }
            elseSteps = els.mapNotNull { parseStep(it) }
            break
        }
        return Step.IfStep(cases, elseSteps)
    }

    private fun parseNoArg(name: String): Action = when (name) {
        "close_menu" -> Action.CloseMenu
        "close_dialog" -> Action.CloseDialog
        "open_previous_menu" -> Action.OpenPreviousMenu
        else -> throw IllegalArgumentException("Unknown no-arg action: $name")
    }

    private fun parseAction(name: String, value: Any?): Action {
        val o = value as? Map<*, *>
        fun arg(k: String): String? = o?.get(k)?.toString()
        return when (name) {
            "send_message" -> Action.SendMessage(textOf(value))
            "broadcast" -> Action.Broadcast(textOf(value))
            "give_xp" -> Action.GiveXp(num(value))
            "give_level" -> Action.GiveLevel(num(value))
            "give_money" -> Action.GiveMoney(
                amount = (value as? Number)?.toDouble() ?: numOrZero(o?.get("amount")),
                currency = arg("currency"),
            )
            "take_money" -> Action.TakeMoney(
                amount = (value as? Number)?.toDouble() ?: numOrZero(o?.get("amount")),
                currency = arg("currency"),
            )
            "run_command" ->
                if (value is String) Action.RunCommand(value, false)
                else Action.RunCommand(arg("command") ?: "", arg("as") == "console")
            "open_menu" ->
                if (value is String) Action.OpenMenu(value)
                else Action.OpenMenu(arg("menu_id") ?: "", contextOf(o), o?.get("clear_context") as? Boolean ?: false)
            "open_dialog" ->
                if (value is String) Action.OpenDialog(value)
                else Action.OpenDialog(arg("dialog_id") ?: "", contextOf(o), o?.get("clear_context") as? Boolean ?: false)
            "close_menu" -> Action.CloseMenu
            "close_dialog" -> Action.CloseDialog
            "open_previous_menu" -> Action.OpenPreviousMenu
            "give_item" ->
                if (value is String) Action.GiveItem(value)
                else Action.GiveItem(
                    material = arg("material") ?: "",
                    count = (o?.get("count") as? Number)?.toInt() ?: 1,
                    name = arg("name"),
                    lore = asList(o?.get("lore")).map { it.toString() },
                )
            "take_item" ->
                if (value is String) Action.TakeItem(value)
                else Action.TakeItem(arg("material") ?: "", (o?.get("count") as? Number)?.toInt() ?: 1)
            "play_sound" ->
                if (value is String) Action.PlaySound(value)
                else Action.PlaySound(arg("sound") ?: "", (o?.get("volume") as? Number)?.toFloat() ?: 1f, (o?.get("pitch") as? Number)?.toFloat() ?: 1f)
            "teleport" -> Action.Teleport(
                world = arg("world"),
                x = numOrZero(o?.get("x")), y = numOrZero(o?.get("y")), z = numOrZero(o?.get("z")),
                yaw = (o?.get("yaw") as? Number)?.toFloat() ?: 0f,
                pitch = (o?.get("pitch") as? Number)?.toFloat() ?: 0f,
            )
            "pagination_next" -> Action.PaginationNext((value as? String)?.ifEmpty { null })
            "pagination_prev" -> Action.PaginationPrev((value as? String)?.ifEmpty { null })
            "show_title" ->
                if (o != null && o.containsKey("title")) Action.ShowTitle(
                    title = textOf(o["title"]),
                    subtitle = o["subtitle"]?.let { textOf(it) },
                    fadeIn = (o["fade_in"] as? Number)?.toInt() ?: 10,
                    stay = (o["stay"] as? Number)?.toInt() ?: 70,
                    fadeOut = (o["fade_out"] as? Number)?.toInt() ?: 20,
                )
                else Action.ShowTitle(title = textOf(value))
            "set_arg" -> Action.SetArg(arg("arg") ?: "", arg("value") ?: "")
            "set_arg_cycle_next" -> Action.SetArgCycleNext(arg("arg") ?: "", arg("list") ?: "")
            "set_arg_cycle_prev" -> Action.SetArgCyclePrev(arg("arg") ?: "", arg("list") ?: "")
            "run_actions" -> Action.RunActions(value?.toString() ?: "")
            else -> throw IllegalArgumentException("Unknown action: $name")
        }
    }

    /** Parse a list of keyed (or legacy `{type}`) conditions: an appearance's `if`. */
    fun parseConditions(raw: Any?): List<Condition> = asList(raw).mapNotNull { parseCondition(it) }

    @Suppress("UNCHECKED_CAST")
    private fun parseCondition(raw: Any?): Condition? {
        val m = raw as? Map<*, *> ?: return null
        // Legacy type-tagged form (`{type: "has_permission", perm: …}`).
        if (m.containsKey("type")) return runCatching { ConditionParser.parse(m as Map<String, Any>) }.getOrNull()
        val (name, value) = singleEntry(m) ?: return null
        val o = value as? Map<*, *>
        fun arg(k: String): String? = o?.get(k)?.toString()
        return when (name) {
            "has_permission" -> Condition.HasPermission(value?.toString() ?: "")
            "has_money" -> Condition.HasMoney((value as? Number)?.toDouble() ?: numOrZero(o?.get("amount")), arg("currency"))
            "has_item" -> Condition.HasItem(arg("material") ?: "", (o?.get("count") as? Number)?.toInt() ?: 1)
            "has_xp" -> Condition.HasXp(num(value))
            "has_level" -> Condition.HasLevel(num(value))
            "world_is" -> Condition.WorldIs(value?.toString() ?: "")
            "random_chance" -> Condition.RandomChance((value as? Number)?.toDouble() ?: 0.0)
            "cooldown_passed" -> Condition.CooldownPassed(value?.toString() ?: "")
            "player_in_region" -> Condition.PlayerInRegion(value?.toString() ?: "")
            "time_is" ->
                if (value is Map<*, *>)
                    Condition.TimeIs("${(value["from_ticks"] as? Number)?.toLong()}-${(value["to_ticks"] as? Number)?.toLong()}")
                else Condition.TimeIs(value?.toString() ?: "day")
            "placeholder_equals" -> Condition.PlaceholderEquals(arg("placeholder") ?: "", arg("value") ?: "")
            "placeholder_match" -> Condition.PlaceholderMatch(arg("placeholder") ?: "", arg("regex") ?: "")
            "pagination_at_first" -> Condition.PaginationAtFirst((value as? String)?.ifEmpty { null })
            "pagination_at_last" -> Condition.PaginationAtLast((value as? String)?.ifEmpty { null })
            "expression" -> Condition.Expression(value?.toString() ?: "")
            "not" -> parseCondition(value)?.let { Condition.Not(it) }
            "and" -> Condition.And(asList(value).mapNotNull { parseCondition(it) })
            "or" -> Condition.Or(asList(value).mapNotNull { parseCondition(it) })
            else -> null
        }
    }

    private fun textOf(value: Any?): LocalizedText = when {
        value is String -> LocalizedText.of(value)
        value is Map<*, *> -> LocalizedText.ofMap(value.entries.associate { it.key.toString() to it.value.toString() })
        value == null -> LocalizedText.of("")
        else -> LocalizedText.of(value.toString())
    }

    private fun contextOf(o: Map<*, *>?): Map<String, String> =
        (o?.get("context") as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value.toString() } ?: emptyMap()

    private fun asList(v: Any?): List<*> = when (v) {
        null -> emptyList<Any?>()
        is List<*> -> v
        else -> listOf(v)
    }

    private fun singleEntry(m: Map<*, *>): Pair<String, Any?>? {
        if (m.size != 1) return null
        val e = m.entries.first()
        return e.key.toString() to e.value
    }

    private fun num(v: Any?): Int = (v as? Number)?.toInt() ?: 0
    private fun numOrZero(v: Any?): Double = (v as? Number)?.toDouble() ?: 0.0
}
