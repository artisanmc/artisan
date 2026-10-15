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

/** Where the addresser finds an action's schema; the core vocabulary by default. */
typealias ActionSchemaLookup = (String) -> ActionSchema?

/**
 * Stamp every text argument of a Step tree with its canonical i18n ADDRESS, so the
 * legacy Action DSL's inline mode can translate it: the file holds the default
 * language's literal, the other languages sit at that address in `lang/<lang>.yaml`.
 *
 * This is the Kotlin half of a cross-language contract — the editor mints the
 * very same addresses in `visitStepLTexts` (`domain/i18nSites.ts`). Both sides
 * must agree exactly, or a translation lands at an address the runtime never
 * looks up. The rules are driven by each action's schema ([ActionSchema], found
 * through [schemaOf]) and locked by the shared vector
 * `testdata/i18n-address-conformance.json`:
 *
 *  - walk order is document order, an `if`'s cases before its `else`;
 *  - an `ltext` argument with a declared slot ([ActionSchema.i18nSlots]) is addressed
 *    `<prefix>.<slot>`, then `<slot>_1`, `<slot>_2`…; the counter is per slot, so
 *    `send_message` and `broadcast` (both `message`) share one;
 *  - any other `ltext` argument hangs off the action's name (`:` read as `.`), numbered
 *    per occurrence of that action: `<prefix>.quests.notify.text`, then
 *    `<prefix>.quests.notify_1.text`; a `list(ltext)` argument numbers its entries
 *    `…lines`, `…lines_2`, `…lines_3`;
 *  - an absent optional text consumes no counter (a `show_title` without a subtitle);
 *  - an action without a schema has no text site.
 *
 * The addresses land on the step keyed by argument name (`lines.1` for a list entry).
 */
fun assignI18nAddresses(
    steps: List<Step>,
    prefix: String,
    schemaOf: ActionSchemaLookup = CoreActions::schema,
): List<Step> {
    val counters = mutableMapOf<String, Int>()
    return steps.map { stamp(it, prefix, counters, schemaOf) }
}

private fun MutableMap<String, Int>.next(slot: String): Int {
    val n = this[slot] ?: 0
    this[slot] = n + 1
    return n
}

private fun suffixed(prefix: String, leaf: String, index: Int): String =
    if (index == 0) "$prefix.$leaf" else "$prefix.${leaf}_$index"

private fun stamp(step: Step, prefix: String, c: MutableMap<String, Int>, schemaOf: ActionSchemaLookup): Step = when (step) {
    is Step.ActionStep -> stampAction(step, prefix, c, schemaOf)
    is Step.IfStep -> Step.IfStep(
        cases = step.cases.map { case -> case.copy(steps = case.steps.map { stamp(it, prefix, c, schemaOf) }) },
        elseSteps = step.elseSteps.map { stamp(it, prefix, c, schemaOf) },
    )
}

private fun stampAction(
    step: Step.ActionStep,
    prefix: String,
    c: MutableMap<String, Int>,
    schemaOf: ActionSchemaLookup,
): Step.ActionStep {
    val schema = schemaOf(step.name) ?: return step
    val args = schema.normalize(step.value)
    val addresses = linkedMapOf<String, String>()
    // The generic base is minted once per step, on its first slot-less text.
    var base: String? = null
    fun baseOf(): String = base ?: suffixed(prefix, step.name.replace(':', '.'), c.next("action:${step.name}")).also { base = it }
    for (arg in schema.args) {
        val kind = arg.type.kind
        val value = args[arg.name]
        val slot = schema.i18nSlots[arg.name]
        when {
            kind == "ltext" -> {
                if (value == null && !arg.isRequired) continue
                addresses[arg.name] =
                    if (slot != null) suffixed(prefix, slot, c.next(slot)) else "${baseOf()}.${arg.name}"
            }
            kind == "list" && arg.type.of?.kind == "ltext" -> {
                val entries = value as? List<*> ?: continue
                val listBase = if (slot != null) suffixed(prefix, slot, c.next(slot)) else "${baseOf()}.${arg.name}"
                entries.forEachIndexed { i, _ ->
                    addresses["${arg.name}.$i"] = if (i == 0) listBase else "${listBase}_${i + 1}"
                }
            }
        }
    }
    return if (addresses.isEmpty()) step else step.copy(i18n = addresses)
}
