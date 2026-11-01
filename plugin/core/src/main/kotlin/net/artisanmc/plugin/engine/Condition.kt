package net.artisanmc.plugin.engine

sealed class Condition {
    data class HasPermission(val perm: String) : Condition()
    data class HasMoney(val amount: Double, val currency: String? = null) : Condition()
    data class HasItem(val material: String, val count: Int = 1) : Condition()
    data class HasXp(val amount: Int) : Condition()
    data class HasLevel(val level: Int) : Condition()
    data class PlaceholderEquals(val placeholder: String, val value: String) : Condition()
    data class PlaceholderMatch(val placeholder: String, val regex: String) : Condition()
    data class CooldownPassed(val cooldownId: String) : Condition()
    data class WorldIs(val world: String) : Condition()
    /** The player's client: `java` or `bedrock` (through Geyser). */
    data class ClientIs(val client: String) : Condition()
    /** The player's client loaded the server's pack (the Bedrock pack for a Bedrock player). */
    data object HasResourcePack : Condition()
    data class TimeIs(val range: String) : Condition()
    data class RandomChance(val probability: Double) : Condition()
    data class PlayerInRegion(val region: String) : Condition()
    data class PaginationAtFirst(val elementId: String? = null) : Condition()
    data class PaginationAtLast(val elementId: String? = null) : Condition()
    /** Comparison / free expression (`balance >= 100`), evaluated by the leaf evaluator (ADR action-dsl §6). */
    data class Expression(val expr: String) : Condition()
    data class Not(val inner: Condition) : Condition()
    data class And(val all: List<Condition>) : Condition()
    data class Or(val any: List<Condition>) : Condition()
}
