package net.artisanmc.plugin.actiondsl

import net.artisanmc.plugin.engine.Action
import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.IfCase
import net.artisanmc.plugin.engine.Step
import net.artisanmc.plugin.expr.Node
import net.artisanmc.plugin.expr.parseExpr

/**
 * Maps the standalone Action DSL AST ({@link DslStep}) onto the plugin engine
 * models ({@link Step}/{@link Action}/{@link Condition}). This is the Phase 1.5
 * bridge (ADR `docs/decisions/action-dsl.md`) that lets `parseActionDsl(...)`
 * output flow into the existing `ActionExecutor`/`ConditionEvaluator`.
 *
 * Text mapping: a literal `{lit:s}` becomes the raw string `s` (an inline
 * template `resolveText`/`ArgResolver` interpolate); an i18n ref `{ref:k}`
 * becomes `"{i18n:k}"` so `resolveText`'s `{i18n:...}` branch localizes it.
 * Numbers are Doubles in the DSL AST (JS-shaped) and narrow to the engine's
 * Int/Float/Double per field.
 */
fun dslToEngineSteps(steps: List<DslStep>): List<Step> = steps.map(::mapStep)

/**
 * Parse an Action DSL string (the canonical menu/command/dialog click-handler
 * wire since Phase 2 of ADR `action-dsl`) into the engine [Step] tree. Blank
 * input → empty list. A malformed string throws [DslParseError] — callers
 * compile inside a `runCatching` so one bad chain drops its own handler with a
 * WARN rather than the whole bundle.
 */
fun compileActionDsl(dsl: String): List<Step> =
    if (dsl.isBlank()) emptyList() else dslToEngineSteps(parseActionDsl(dsl))

private fun mapStep(step: DslStep): Step = when (step) {
    is DslStep.ActionStep -> Step.ActionStep(mapAction(step.action))
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

/** `{lit:s}` → `s` ; `{ref:k}` → `"{i18n:k}"` (localized by `resolveText`). */
private fun mapText(text: DslText): String = when (text) {
    is DslText.Lit -> text.lit
    is DslText.Ref -> "{i18n:${text.ref}}"
}

private fun mapAction(a: DslAction): Action = when (a) {
    is DslAction.Broadcast -> Action.Broadcast(mapText(a.text))
    is DslAction.SendMessage -> Action.SendMessage(mapText(a.text))
    is DslAction.GiveItem -> Action.GiveItem(a.material, a.count.toInt())
    is DslAction.TakeItem -> Action.TakeItem(a.material, a.count.toInt())
    is DslAction.GiveMoney -> Action.GiveMoney(a.amount)
    is DslAction.TakeMoney -> Action.TakeMoney(a.amount)
    is DslAction.GiveXp -> Action.GiveXp(a.amount.toInt())
    is DslAction.GiveLevel -> Action.GiveLevel(a.amount.toInt())
    is DslAction.RunCommand -> Action.RunCommand(a.command, asConsole = a.asConsole == "console")
    is DslAction.PlaySound -> Action.PlaySound(
        sound = a.sound,
        volume = a.volume?.toFloat() ?: 1f,
        pitch = a.pitch?.toFloat() ?: 1f,
    )
    is DslAction.Teleport -> Action.Teleport(
        world = a.world,
        x = a.x,
        y = a.y,
        z = a.z,
        yaw = a.yaw?.toFloat() ?: 0f,
        pitch = a.pitch?.toFloat() ?: 0f,
    )
    is DslAction.ShowTitle -> Action.ShowTitle(
        title = mapText(a.title),
        subtitle = a.subtitle?.let(::mapText),
        fadeIn = a.fadeIn?.toInt() ?: 10,
        stay = a.stay?.toInt() ?: 70,
        fadeOut = a.fadeOut?.toInt() ?: 20,
    )
    is DslAction.OpenMenu -> Action.OpenMenu(a.menuId, a.context ?: emptyMap(), a.clearContext)
    is DslAction.OpenDialog -> Action.OpenDialog(a.dialogId, a.context ?: emptyMap(), a.clearContext)
    DslAction.CloseMenu -> Action.CloseMenu
    DslAction.CloseDialog -> Action.CloseDialog
    is DslAction.Paginate ->
        if (a.direction == "prev") Action.PaginationPrev(a.targetElementId)
        else Action.PaginationNext(a.targetElementId)
    is DslAction.RunActions -> Action.RunActions(a.actions)
    is DslAction.SetArg -> Action.SetArg(a.arg, setArgText(a.value))
    is DslAction.SetArgCycleNext -> Action.SetArgCycleNext(a.arg, a.list)
    is DslAction.SetArgCyclePrev -> Action.SetArgCyclePrev(a.arg, a.list)
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
