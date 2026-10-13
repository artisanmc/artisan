package net.artisanmc.plugin.actiondsl

/**
 * Action DSL printer. Language-symmetric port of
 * `editor/src/lib/actionDsl/printer.ts`. `printActionDsl(steps)` → the canonical
 * text form. Inverse of the parser: `print(parse(dsl))` equals the canonical DSL.
 * 2-space indent.
 */

private const val INDENT = "  "

fun printActionDsl(steps: List<DslStep>): String = printBlock(steps, 0).joinToString("\n")

private fun printBlock(steps: List<DslStep>, depth: Int): List<String> {
    val out = mutableListOf<String>()
    for (step in steps) {
        when (step) {
            is DslStep.ActionStep -> out.add(INDENT.repeat(depth) + printAction(step.action))
            is DslStep.IfStep -> {
                step.cases.forEachIndexed { i, c ->
                    val kw = if (i == 0) "if" else "else if"
                    out.add("${INDENT.repeat(depth)}$kw ${printFlat(c.conditions, c.joins)}:")
                    out.addAll(printBlock(c.steps, depth + 1))
                }
                if (step.elseSteps != null) {
                    out.add("${INDENT.repeat(depth)}else:")
                    out.addAll(printBlock(step.elseSteps, depth + 1))
                }
            }
        }
    }
    return out
}

private fun printText(t: DslText): String = when (t) {
    is DslText.Lit -> jsonStr(t.lit)
    is DslText.Ref -> "@${t.ref}"
}

private fun opt(prefix: String, n: Double?): String = if (n == null) "" else "$prefix${jsNum(n)}"

private fun printAction(a: DslAction): String = when (a) {
    is DslAction.Broadcast -> "broadcast ${printText(a.text)}"
    is DslAction.SendMessage -> "send_message ${printText(a.text)}"
    is DslAction.GiveItem -> "give_item ${a.material} ${jsNum(a.count)}"
    is DslAction.TakeItem -> "take_item ${a.material} ${jsNum(a.count)}"
    is DslAction.GiveMoney -> "give_money ${jsNum(a.amount)}"
    is DslAction.TakeMoney -> "take_money ${jsNum(a.amount)}"
    is DslAction.GiveXp -> "give_xp ${jsNum(a.amount)}"
    is DslAction.GiveLevel -> "give_level ${jsNum(a.amount)}"
    is DslAction.RunCommand -> "run_command ${jsonStr(a.command)} as ${a.asConsole}"
    is DslAction.PlaySound -> "play_sound ${a.sound}${opt(" vol=", a.volume)}${opt(" pitch=", a.pitch)}"
    is DslAction.Teleport ->
        "teleport ${a.world} ${jsNum(a.x)} ${jsNum(a.y)} ${jsNum(a.z)}${opt(" yaw=", a.yaw)}${opt(" pitch=", a.pitch)}"
    is DslAction.ShowTitle ->
        "show_title ${printText(a.title)}${if (a.subtitle != null) " ${printText(a.subtitle)}" else ""}" +
            "${opt(" fadeIn=", a.fadeIn)}${opt(" stay=", a.stay)}${opt(" fadeOut=", a.fadeOut)}"
    is DslAction.OpenMenu -> "open_menu ${a.menuId}${menuTail(a.clearContext, a.context)}"
    is DslAction.OpenDialog -> "open_dialog ${a.dialogId}${menuTail(a.clearContext, a.context)}"
    is DslAction.CloseMenu -> "close_menu"
    is DslAction.CloseDialog -> "close_dialog"
    is DslAction.OpenPreviousMenu -> "open_previous_menu"
    is DslAction.Paginate ->
        "paginate ${a.direction}${if (a.targetElementId != null) " ${a.targetElementId}" else ""}"
    is DslAction.RunActions -> "run_actions ${a.actions}"
    is DslAction.SetArg -> "set ${a.arg} = ${a.value}"
    is DslAction.SetArgCycleNext -> "cycle ${a.arg} in ${a.list}"
    is DslAction.SetArgCyclePrev -> "cycle prev ${a.arg} in ${a.list}"
}

private fun menuTail(clear: Boolean, context: Map<String, String>?): String {
    var s = if (clear) " clear" else ""
    if (context != null && context.isNotEmpty()) {
        s += " with " + context.entries.joinToString(" ") { (k, v) -> "$k=${jsonStr(v)}" }
    }
    return s
}

private fun printFlat(conditions: List<DslCondition>, joins: List<String>?): String {
    val out = StringBuilder(printAtom(conditions[0]))
    for (i in 1 until conditions.size) {
        out.append(" ${joins?.getOrNull(i - 1) ?: "and"} ${printAtom(conditions[i])}")
    }
    return out.toString()
}

private val IDENT_RE = Regex("^[A-Za-z0-9_.]+$")
private fun arg(v: String): String = if (IDENT_RE.matches(v)) v else jsonStr(v)

private fun printAtom(c: DslCondition): String = when (c) {
    is DslCondition.HasPermission -> "has_permission(${arg(c.perm)})"
    is DslCondition.HasMoney -> "has_money(${jsNum(c.amount)})"
    is DslCondition.HasItem -> "has_item(${arg(c.material)}, ${jsNum(c.count)})"
    is DslCondition.HasXp -> "has_xp(${jsNum(c.amount)})"
    is DslCondition.HasLevel -> "has_level(${jsNum(c.level)})"
    is DslCondition.WorldIs -> "world_is(${arg(c.world)})"
    is DslCondition.RandomChance -> "random_chance(${jsNum(c.probability)})"
    is DslCondition.CooldownPassed -> "cooldown_passed(${arg(c.cooldownId)})"
    is DslCondition.PlayerInRegion -> "player_in_region(${arg(c.region)})"
    is DslCondition.TimeIs -> "time_is(${
        when (val r = c.range) {
            is TimeRange.Named -> r.name
            is TimeRange.Ticks -> "${r.fromTicks}-${r.toTicks}"
        }
    })"
    is DslCondition.PaginationAtFirst ->
        "pagination_at_first${if (c.elementId != null) "(${arg(c.elementId)})" else ""}"
    is DslCondition.PaginationAtLast ->
        "pagination_at_last${if (c.elementId != null) "(${arg(c.elementId)})" else ""}"
    is DslCondition.PlaceholderEquals -> "${c.placeholder} == ${jsonStr(c.value)}"
    is DslCondition.PlaceholderMatch -> "${c.placeholder} matches ${jsonStr(c.regex)}"
    is DslCondition.Expression -> c.expr
    is DslCondition.Not -> "not ${printAtom(c.of)}"
    is DslCondition.And -> "(${c.of.joinToString(" and ") { printAtom(it) }})"
    is DslCondition.Or -> "(${c.of.joinToString(" or ") { printAtom(it) }})"
}
