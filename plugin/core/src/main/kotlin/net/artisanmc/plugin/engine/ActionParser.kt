package net.artisanmc.plugin.engine

/**
 * Pre-DSL legacy wire: a type-tagged action (`{type: open_menu, menu_id: shop}`). The tag is
 * the action's name, the other keys are its arguments in the keyed wire's spelling, so the
 * legacy object and the keyed map (`open_menu: {menu_id: shop}`) reach the handler as the
 * same argument map. Only the spellings the keyed wire dropped are translated here.
 */
object ActionParser {
    fun parse(raw: Map<String, Any>): Step.ActionStep {
        val type = raw["type"]?.toString()
            ?: throw IllegalArgumentException("Action missing 'type' field: $raw")
        val args = LinkedHashMap<String, Any>()
        raw.forEach { (k, v) -> if (k != "type" && v != null) args[k] = v }
        // `as_console: true` was the boolean spelling of `as: console`.
        if (args.remove("as_console") == true) args["as"] = "console"
        return Step.ActionStep(type, args.ifEmpty { null })
    }
}
