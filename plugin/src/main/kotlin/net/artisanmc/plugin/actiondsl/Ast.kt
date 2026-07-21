package net.artisanmc.plugin.actiondsl

/**
 * Action DSL AST — the pure, Project-free representation the Action DSL parses to
 * and prints from. Cf. ADR `docs/decisions/action-dsl.md`. This is a language-
 * symmetric mirror of the TS AST in `editor/src/lib/actionDsl/ast.ts`; it is
 * DELIBERATELY decoupled from the plugin engine models (`engine/Action.kt`,
 * `engine/Condition.kt`). The DSL→engine mapping is a separate (Phase 1.5)
 * concern. The cross-stack invariant locked here is the TEXT round-trip, not
 * AST-JSON equality.
 */

/** A text argument: an inline literal (`"..."`) or an i18n key reference (`@key`). */
sealed interface DslText {
    data class Lit(val lit: String) : DslText
    data class Ref(val ref: String) : DslText
}

/** A time_is range: a named window (day|night) or an explicit tick range. */
sealed interface TimeRange {
    data class Named(val name: String) : TimeRange
    data class Ticks(val fromTicks: Int, val toTicks: Int) : TimeRange
}

/** Conditions after `if` — typed vocabulary + `expression` fallback + and/or/not. */
sealed interface DslCondition {
    data class HasPermission(val perm: String) : DslCondition
    data class HasMoney(val amount: Double) : DslCondition
    data class HasItem(val material: String, val count: Double) : DslCondition
    data class HasXp(val amount: Double) : DslCondition
    data class HasLevel(val level: Double) : DslCondition
    data class WorldIs(val world: String) : DslCondition
    data class RandomChance(val probability: Double) : DslCondition
    data class CooldownPassed(val cooldownId: String) : DslCondition
    data class PlayerInRegion(val region: String) : DslCondition
    data class TimeIs(val range: TimeRange) : DslCondition
    data class PaginationAtFirst(val elementId: String? = null) : DslCondition
    data class PaginationAtLast(val elementId: String? = null) : DslCondition
    data class PlaceholderEquals(val placeholder: String, val value: String) : DslCondition
    data class PlaceholderMatch(val placeholder: String, val regex: String) : DslCondition
    data class Expression(val expr: String) : DslCondition
    data class Not(val of: DslCondition) : DslCondition
    data class And(val of: List<DslCondition>) : DslCondition
    data class Or(val of: List<DslCondition>) : DslCondition
}

/** Actions that carry text use {@link DslText}; all numbers are Doubles (JS-shaped). */
sealed interface DslAction {
    data class Broadcast(val text: DslText) : DslAction
    data class SendMessage(val text: DslText) : DslAction
    data class GiveItem(val material: String, val count: Double) : DslAction
    data class TakeItem(val material: String, val count: Double) : DslAction
    data class GiveMoney(val amount: Double) : DslAction
    data class TakeMoney(val amount: Double) : DslAction
    data class GiveXp(val amount: Double) : DslAction
    data class GiveLevel(val amount: Double) : DslAction
    data class RunCommand(val command: String, val asConsole: String) : DslAction
    data class PlaySound(val sound: String, val volume: Double? = null, val pitch: Double? = null) : DslAction
    data class Teleport(
        val world: String,
        val x: Double,
        val y: Double,
        val z: Double,
        val yaw: Double? = null,
        val pitch: Double? = null,
    ) : DslAction
    data class ShowTitle(
        val title: DslText,
        val subtitle: DslText? = null,
        val fadeIn: Double? = null,
        val stay: Double? = null,
        val fadeOut: Double? = null,
    ) : DslAction
    data class OpenMenu(
        val menuId: String,
        val clearContext: Boolean = false,
        val context: Map<String, String>? = null,
    ) : DslAction
    data class OpenDialog(
        val dialogId: String,
        val clearContext: Boolean = false,
        val context: Map<String, String>? = null,
    ) : DslAction
    data object CloseMenu : DslAction
    data object CloseDialog : DslAction
    data class Paginate(val direction: String, val targetElementId: String? = null) : DslAction
    data class RunActions(val actions: String) : DslAction
    data class SetArg(val arg: String, val value: String) : DslAction
    data class SetArgCycleNext(val arg: String, val list: String) : DslAction
    data class SetArgCyclePrev(val arg: String, val list: String) : DslAction
}

data class DslIfCase(
    val conditions: List<DslCondition>,
    val joins: List<String>? = null,
    val steps: List<DslStep>,
)

sealed interface DslStep {
    data class ActionStep(val action: DslAction) : DslStep
    data class IfStep(val cases: List<DslIfCase>, val elseSteps: List<DslStep>? = null) : DslStep
}
