package net.artisanmc.plugin.engine

/**
 * Where each localizable text of a project is addressed — the Kotlin owner of
 * the position → address mapping, mirror of the editor's `lib/i18nKeys.ts`.
 *
 * Inline mode makes these addresses load-bearing: the document holds the
 * default language's literal, and every other language sits at the site's
 * address in `lang/<lang>.yaml`. Both sides derive them independently, so they
 * live in ONE place per language and are locked together by the shared vector
 * `testdata/i18n-address-conformance.json`.
 */
object I18nAddress {

    /** Appearance state segment: the first is `default`, then `state1`, `state2`… */
    fun state(appearanceIndex: Int): String =
        if (appearanceIndex == 0) "default" else "state$appearanceIndex"

    /** Base of one appearance — the prefix its title/lore/clicks hang off. */
    fun appearance(menuId: String, elementId: String, appearanceIndex: Int): String =
        "menus.$menuId.elements.$elementId.${state(appearanceIndex)}"

    /** Action-chain prefix of a click handler, keyed on the WIRE click key. */
    fun clickHandler(appearanceBase: String, clickKey: String): String =
        "$appearanceBase.click.$clickKey"

    /** Nth text-bearing title layer: the first is `…title`, then `_2`, `_3`… */
    fun menuTitleLayer(menuId: String, textLayerIndex: Int): String =
        if (textLayerIndex == 0) "menus.$menuId.title" else "menus.$menuId.title_${textLayerIndex + 1}"

    /** Action-chain prefix of a command. */
    fun command(commandId: String): String = "commands.$commandId"

    fun dialogTitle(dialogId: String): String = "dialogs.$dialogId.title"

    /** Dialog body text, addressed by INDEX (bodies have no ids). */
    fun dialogBody(dialogId: String, index: Int): String = "dialogs.$dialogId.body.$index.text"

    fun dialogInputLabel(dialogId: String, inputId: String): String =
        "dialogs.$dialogId.inputs.$inputId.label"

    fun dialogOptionLabel(dialogId: String, inputId: String, optionValue: String): String =
        "dialogs.$dialogId.inputs.$inputId.options.$optionValue.label"

    fun dialogButtonLabel(dialogId: String, buttonId: String): String =
        "dialogs.$dialogId.buttons.$buttonId.label"

    /** Action-chain prefix of a dialog button. */
    fun dialogButton(dialogId: String, buttonId: String): String =
        "dialogs.$dialogId.buttons.$buttonId"
}

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
    is Step.ActionStep -> stampAction(step, prefix, c)
    is Step.IfStep -> Step.IfStep(
        cases = step.cases.map { case -> case.copy(steps = case.steps.map { stamp(it, prefix, c) }) },
        elseSteps = step.elseSteps.map { stamp(it, prefix, c) },
    )
}

/**
 * The legacy DSL's addressing table: only the DSL (read-only since ADR
 * `structured-action-wire`) addresses action text by position; the keyed wire is
 * field-local. The three addressed actions are therefore fixed here, by wire name,
 * and the addresses land on the step keyed by argument name.
 */
private fun stampAction(step: Step.ActionStep, prefix: String, c: Counters): Step.ActionStep = when (step.name) {
    "send_message", "broadcast" -> step.copy(i18n = mapOf("text" to suffixed(prefix, "message", c.message++)))
    "show_title" -> {
        val hasSubtitle = (step.value as? Map<*, *>)?.get("subtitle") != null
        val addresses = linkedMapOf("title" to suffixed(prefix, "show_title", c.title++))
        if (hasSubtitle) addresses["subtitle"] = suffixed(prefix, "show_subtitle", c.subtitle++)
        step.copy(i18n = addresses)
    }
    else -> step
}
