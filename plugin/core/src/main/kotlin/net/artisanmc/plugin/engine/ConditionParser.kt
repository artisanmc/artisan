package net.artisanmc.plugin.engine

object ConditionParser {

    @Suppress("UNCHECKED_CAST")
    fun parse(raw: Map<String, Any>): Condition {
        val type = raw["type"]?.toString()
            ?: throw IllegalArgumentException("Condition missing 'type' field: $raw")
        return when (type) {
            "has_permission"     -> Condition.HasPermission(str(raw, "perm"))
            "has_money"          -> Condition.HasMoney((raw["amount"] as Number).toDouble(), raw["currency"] as? String)
            "has_item"           -> Condition.HasItem(str(raw, "material"), (raw["count"] as? Number)?.toInt() ?: 1)
            "has_xp"             -> Condition.HasXp((raw["amount"] as Number).toInt())
            "has_level"          -> Condition.HasLevel((raw["level"] as Number).toInt())
            "placeholder_equals" -> Condition.PlaceholderEquals(str(raw, "placeholder"), str(raw, "value"))
            "placeholder_match"  -> Condition.PlaceholderMatch(str(raw, "placeholder"), str(raw, "regex"))
            "cooldown_passed"    -> Condition.CooldownPassed(str(raw, "cooldown_id"))
            "world_is"           -> Condition.WorldIs(str(raw, "world"))
            "time_is"            -> Condition.TimeIs(parseTimeRange(raw["range"]))
            "random_chance"      -> Condition.RandomChance((raw["probability"] as Number).toDouble())
            "player_in_region"   -> Condition.PlayerInRegion(str(raw, "region"))
            "pagination_at_first"-> Condition.PaginationAtFirst(raw["element_id"] as? String)
            "pagination_at_last" -> Condition.PaginationAtLast(raw["element_id"] as? String)
            "expression"         -> Condition.Expression(str(raw, "expr"))
            "not"                -> Condition.Not(parse(raw["of"] as Map<String, Any>))
            "and"                -> Condition.And((raw["of"] as List<*>).map { parse(it as Map<String, Any>) })
            "or"                 -> Condition.Or((raw["of"] as List<*>).map { parse(it as Map<String, Any>) })
            else                 -> throw IllegalArgumentException("Unknown condition type: $type")
        }
    }

    private fun str(raw: Map<String, Any>, key: String): String =
        raw[key]?.toString() ?: throw IllegalArgumentException("Condition missing required field '$key': $raw")

    /** The schema accepts "day"/"night"/"a-b" or {from_ticks,to_ticks}, normalized to an "a-b" string. */
    private fun parseTimeRange(range: Any?): String = when (range) {
        is Map<*, *> -> {
            val from = (range["from_ticks"] as? Number)?.toLong()
            val to   = (range["to_ticks"] as? Number)?.toLong()
            if (from == null || to == null)
                throw IllegalArgumentException("time_is object range needs from_ticks and to_ticks: $range")
            "$from-$to"
        }
        null -> throw IllegalArgumentException("Condition time_is missing required field 'range'")
        else -> range.toString()
    }
}
