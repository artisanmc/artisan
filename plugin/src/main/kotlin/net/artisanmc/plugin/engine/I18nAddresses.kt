package net.artisanmc.plugin.engine

/**
 * Stamp every text-bearing action of a Step tree with its canonical i18n
 * ADDRESS, so inline mode can translate it: the file holds the default
 * language's literal, the other languages sit at that address in
 * `lang/<lang>.yaml`.
 *
 * This is the Kotlin half of a cross-language contract — the editor mints the
 * very same addresses in `visitStepLTexts` (`domain/i18nSites.ts`). Both sides
 * must agree exactly, or a translation lands at an address the runtime never
 * looks up. The rules, and the shared vector that locks them:
 *
 *  - walk order is document order, an `if`'s cases before its `else`;
 *  - messages, titles and subtitles keep INDEPENDENT counters;
 *  - `send_message` and `broadcast` share the message counter;
 *  - the first of each kind has no suffix (`.message`, `.show_title`,
 *    `.show_subtitle`), the rest are suffixed from `_1` on;
 *  - a `show_title` without a subtitle consumes no subtitle counter.
 */
fun assignI18nAddresses(steps: List<Step>, prefix: String): List<Step> {
    val counters = Counters()
    return steps.map { stamp(it, prefix, counters) }
}

private class Counters {
    var message = 0
    var title = 0
    var subtitle = 0
}

private fun suffixed(prefix: String, leaf: String, index: Int): String =
    if (index == 0) "$prefix.$leaf" else "$prefix.${leaf}_$index"

private fun stamp(step: Step, prefix: String, c: Counters): Step = when (step) {
    is Step.ActionStep -> Step.ActionStep(stampAction(step.action, prefix, c))
    is Step.IfStep -> Step.IfStep(
        cases = step.cases.map { case -> case.copy(steps = case.steps.map { stamp(it, prefix, c) }) },
        elseSteps = step.elseSteps.map { stamp(it, prefix, c) },
    )
}

private fun stampAction(action: Action, prefix: String, c: Counters): Action = when (action) {
    is Action.SendMessage -> action.copy(i18n = suffixed(prefix, "message", c.message++))
    is Action.Broadcast -> action.copy(i18n = suffixed(prefix, "message", c.message++))
    is Action.ShowTitle -> action.copy(
        i18nTitle = suffixed(prefix, "show_title", c.title++),
        i18nSubtitle = action.subtitle?.let { suffixed(prefix, "show_subtitle", c.subtitle++) },
    )
    else -> action
}
