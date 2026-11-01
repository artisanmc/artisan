package net.artisanmc.plugin.engine

import net.artisanmc.plugin.actiondsl.*
import net.artisanmc.plugin.expr.Node
import net.artisanmc.plugin.expr.parseExpr

/**
 * Maps the standalone Action DSL AST ({@link DslStep}) onto the plugin engine
 * models ({@link Step}/{@link Condition}): each verb becomes the keyed wire step the
 * editor would write, so `parseActionDsl(...)` output flows into
 * `ActionExecutor`/`ConditionEvaluator` like the structured wire (ADR `action-dsl`).
 *
 * Text mapping: a literal `{lit:s}` becomes the raw string `s` (an inline
 * template `resolveText`/`ArgResolver` interpolate); an i18n ref `{ref:k}`
 * becomes `"{i18n:k}"` so `resolveText`'s `{i18n:...}` branch localizes it.
 * Numbers are Doubles in the DSL AST (JS-shaped); counts narrow to Int like the
 * keyed wire, the handlers coerce the rest.
 */
fun dslToEngineSteps(steps: List<DslStep>): List<Step> = steps.map(::mapStep)

/**
 * Parse an Action DSL string (the canonical menu/command/dialog click-handler
 * wire, ADR `action-dsl`) into the engine [Step] tree. Blank
 * input → empty list. A malformed string throws [DslParseError] — callers
 * compile inside a `runCatching` so one bad chain drops its own handler with a
 * WARN rather than the whole Project.
 */
fun compileActionDsl(dsl: String): List<Step> =
    if (dsl.isBlank()) emptyList() else dslToEngineSteps(parseActionDsl(dsl))

private fun mapStep(step: DslStep): Step = when (step) {
    is DslStep.ActionStep -> mapAction(step.action)
    is DslStep.IfStep -> Step.IfStep(
        cases = step.cases.map { c ->
            IfCase(
                conditions = c.conditions.map(::mapCondition),
                joins = c.joins ?: emptyList(),
                steps = dslToEngineSteps(c.steps),
            )
        },
        elseSteps = dslToEngineSteps(step.elseSteps ?: emptyList()),
    )
}

/** `{lit:s}` → literal ; `{ref:k}` → `"{i18n:k}"` (localized by `resolveText`). */
private fun mapText(text: DslText): String = when (text) {
    is DslText.Lit -> text.lit
    is DslText.Ref -> "{i18n:${text.ref}}"
}

private fun args(vararg pairs: Pair<String, Any?>): Map<String, Any> =
    linkedMapOf<String, Any>().apply { pairs.forEach { (k, v) -> if (v != null) put(k, v) } }

/** A DSL verb → the keyed wire step the engine dispatches (the canonical form the editor writes). */
private fun mapAction(a: DslAction): Step.ActionStep = when (a) {
    is DslAction.Broadcast -> Step.ActionStep("broadcast", mapText(a.text))
    is DslAction.SendMessage -> Step.ActionStep("send_message", mapText(a.text))
    is DslAction.GiveItem -> Step.ActionStep("give_item", args("material" to a.material, "count" to a.count.toInt()))
    is DslAction.TakeItem -> Step.ActionStep("take_item", args("material" to a.material, "count" to a.count.toInt()))
    is DslAction.GiveMoney -> Step.ActionStep("give_money", a.amount)
    is DslAction.TakeMoney -> Step.ActionStep("take_money", a.amount)
    is DslAction.GiveXp -> Step.ActionStep("give_xp", a.amount.toInt())
    is DslAction.GiveLevel -> Step.ActionStep("give_level", a.amount.toInt())
    is DslAction.RunCommand ->
        if (a.asConsole == "console") Step.ActionStep("run_command", args("command" to a.command, "as" to "console"))
        else Step.ActionStep("run_command", a.command)
    is DslAction.PlaySound ->
        if (a.volume == null && a.pitch == null) Step.ActionStep("play_sound", a.sound)
        else Step.ActionStep("play_sound", args("sound" to a.sound, "volume" to a.volume, "pitch" to a.pitch))
    is DslAction.Teleport -> Step.ActionStep(
        "teleport",
        args("world" to a.world, "x" to a.x, "y" to a.y, "z" to a.z, "yaw" to a.yaw, "pitch" to a.pitch),
    )
    is DslAction.ShowTitle ->
        if (a.subtitle == null && a.fadeIn == null && a.stay == null && a.fadeOut == null) Step.ActionStep("show_title", mapText(a.title))
        else Step.ActionStep(
            "show_title",
            args(
                "title" to mapText(a.title), "subtitle" to a.subtitle?.let(::mapText),
                "fade_in" to a.fadeIn?.toInt(), "stay" to a.stay?.toInt(), "fade_out" to a.fadeOut?.toInt(),
            ),
        )
    is DslAction.OpenMenu ->
        if (a.context.isNullOrEmpty() && !a.clearContext) Step.ActionStep("open_menu", a.menuId)
        else Step.ActionStep("open_menu", args("menu_id" to a.menuId, "context" to a.context, "clear_context" to a.clearContext.takeIf { it }))
    is DslAction.OpenDialog ->
        if (a.context.isNullOrEmpty() && !a.clearContext) Step.ActionStep("open_dialog", a.dialogId)
        else Step.ActionStep("open_dialog", args("dialog_id" to a.dialogId, "context" to a.context, "clear_context" to a.clearContext.takeIf { it }))
    DslAction.CloseMenu -> Step.ActionStep("close_menu")
    DslAction.CloseDialog -> Step.ActionStep("close_dialog")
    DslAction.OpenPreviousMenu -> Step.ActionStep("open_previous_menu")
    is DslAction.Paginate ->
        Step.ActionStep(if (a.direction == "prev") "pagination_prev" else "pagination_next", a.targetElementId)
    is DslAction.RunActions -> Step.ActionStep("run_actions", a.actions)
    is DslAction.SetArg -> Step.ActionStep("set_arg", args("arg" to a.arg, "value" to setArgText(a.value)))
    is DslAction.SetArgCycleNext -> Step.ActionStep("set_arg_cycle_next", args("arg" to a.arg, "list" to a.list))
    is DslAction.SetArgCyclePrev -> Step.ActionStep("set_arg_cycle_prev", args("arg" to a.arg, "list" to a.list))
}

/** The engine consumes template text; DSL string delimiters are not part of that text. */
private fun setArgText(value: String): String {
    val literal = runCatching { parseExpr(value) as? Node.Literal }.getOrNull()
    return literal?.value as? String ?: value
}

private fun mapCondition(c: DslCondition): Condition = when (c) {
    is DslCondition.HasPermission -> Condition.HasPermission(c.perm)
    is DslCondition.HasMoney -> Condition.HasMoney(c.amount)
    is DslCondition.HasItem -> Condition.HasItem(c.material, c.count.toInt())
    is DslCondition.HasXp -> Condition.HasXp(c.amount.toInt())
    is DslCondition.HasLevel -> Condition.HasLevel(c.level.toInt())
    is DslCondition.WorldIs -> Condition.WorldIs(c.world)
    is DslCondition.RandomChance -> Condition.RandomChance(c.probability)
    is DslCondition.CooldownPassed -> Condition.CooldownPassed(c.cooldownId)
    is DslCondition.PlayerInRegion -> Condition.PlayerInRegion(c.region)
    is DslCondition.HasVar -> Condition.HasVar(c.name)
    is DslCondition.TimeIs -> Condition.TimeIs(
        when (val r = c.range) {
            is TimeRange.Named -> r.name
            is TimeRange.Ticks -> "${r.fromTicks}-${r.toTicks}"
        },
    )
    is DslCondition.PaginationAtFirst -> Condition.PaginationAtFirst(c.elementId)
    is DslCondition.PaginationAtLast -> Condition.PaginationAtLast(c.elementId)
    is DslCondition.PlaceholderEquals -> Condition.PlaceholderEquals(c.placeholder, c.value)
    is DslCondition.PlaceholderMatch -> Condition.PlaceholderMatch(c.placeholder, c.regex)
    is DslCondition.Expression -> Condition.Expression(c.expr)
    is DslCondition.Not -> Condition.Not(mapCondition(c.of))
    is DslCondition.And -> Condition.And(c.of.map(::mapCondition))
    is DslCondition.Or -> Condition.Or(c.of.map(::mapCondition))
}
