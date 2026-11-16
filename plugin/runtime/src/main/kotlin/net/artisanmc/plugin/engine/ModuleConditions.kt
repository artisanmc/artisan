package net.artisanmc.plugin.engine

import java.util.concurrent.ConcurrentHashMap
import net.artisanmc.modules.api.condition.ConditionsApi
import org.bukkit.entity.Player

/**
 * `api.getConditions()`: a module's condition list, read strictly
 * ([KeyedStepParser.parseConditionStrict]) and evaluated by the engine's
 * [ConditionEvaluator]. The evaluator is read at call time: it is rebuilt on reload
 * and absent before the first start.
 */
class ModuleConditions(
    private val evaluator: () -> ConditionEvaluator?,
    private val ownsPlayer: (Player) -> Boolean,
    private val warn: (String) -> Unit,
) : ConditionsApi {

    /** Each distinct problem is logged once: a requirement is tested on every check. */
    private val warned = ConcurrentHashMap.newKeySet<String>()

    override fun test(player: Player, conditions: List<*>, args: Map<String, *>): Boolean {
        check(ownsPlayer(player)) {
            "api.getConditions().test must run on the thread that owns ${player.name}"
        }
        if (conditions.isEmpty()) return true
        val parsed = conditions.map { KeyedStepParser.parseConditionStrict(it) }
        if (null in parsed) {
            problems(conditions).forEach(::warnOnce)
            return false
        }
        val engine = evaluator() ?: run {
            warnOnce("module conditions tested before the engine started: treated as false")
            return false
        }
        @Suppress("UNCHECKED_CAST")
        val bound = args.filterKeys { it != null }.filterValues { it != null } as Map<String, Any>
        return engine.evaluateAll(parsed.filterNotNull(), ExecutionContext(player = player, args = bound))
    }

    override fun testWithoutPlayer(conditions: List<*>, args: Map<String, *>, projectId: String?): Boolean {
        if (conditions.isEmpty()) return true
        val problems = problemsWithoutPlayer(conditions)
        if (problems.isNotEmpty()) {
            problems.forEach(::warnOnce)
            return false
        }
        val engine = evaluator() ?: run {
            warnOnce("module conditions tested before the engine started: treated as false")
            return false
        }
        @Suppress("UNCHECKED_CAST")
        val bound = args.filterKeys { it != null }.filterValues { it != null } as Map<String, Any>
        return engine.evaluateAllWithoutPlayer(conditions.map { KeyedStepParser.parseConditionStrict(it)!! }, bound, projectId)
    }

    override fun validate(conditions: List<*>): List<String> = problems(conditions)

    override fun validateWithoutPlayer(conditions: List<*>): List<String> = problemsWithoutPlayer(conditions)

    /** [problems], then each well-formed entry that reads a player, with what in it does. */
    private fun problemsWithoutPlayer(conditions: List<*>): List<String> =
        conditions.mapIndexedNotNull { i, raw ->
            val parsed = KeyedStepParser.parseConditionStrict(raw)
                ?: return@mapIndexedNotNull "condition #$i is unknown, malformed or missing an argument: $raw"
            val reasons = PlayerBound.reasons(parsed)
            if (reasons.isEmpty()) null
            else "condition #$i needs a player (${reasons.joinToString(", ")}) and is tested without one: $raw"
        }

    private fun problems(conditions: List<*>): List<String> =
        conditions.mapIndexedNotNull { i, raw ->
            if (KeyedStepParser.parseConditionStrict(raw) == null)
                "condition #$i is unknown, malformed or missing an argument: $raw"
            else null
        }

    private fun warnOnce(message: String) {
        if (warned.size < MAX_WARNINGS && warned.add(message)) warn(message)
    }

    private companion object {
        const val MAX_WARNINGS = 256
    }
}
