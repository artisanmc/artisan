package net.artisanmc.modules.triggers

import net.artisanmc.modules.api.action.ModuleActionsApi
import net.artisanmc.modules.api.condition.ConditionsApi
import net.artisanmc.modules.api.cooldown.CooldownApi
import net.artisanmc.modules.api.gameevent.GameEventFrame
import net.artisanmc.modules.api.gameevent.GameEventListener
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Runs the Triggers of a fired Game event (ADR `triggers-and-variables` §1 and §8): in the order of
 * their qualified id, each one filtered by `enabled`, its per-player cooldown and its `if:`, then
 * its chain run inline with the event bound under `event`. One Trigger failing does not stop the
 * next. Past [MAX_DEPTH] nested Trigger runs on one thread, the next event runs no Trigger.
 *
 * The cooldown goes to [cooldowns] (`api.cooldowns`, id `triggers:<project>/<id>`): kept in the
 * suite database like a menu's, it survives a restart and follows the player across the network.
 */
internal class TriggerDispatcher(
    private val actions: () -> ModuleActionsApi,
    private val conditions: () -> ConditionsApi,
    private val cooldowns: () -> CooldownApi,
    private val warn: (String) -> Unit,
) : GameEventListener {
    /** Event name → its Triggers, sorted by ref. Swapped whole on reload. */
    @Volatile private var byEvent: Map<String, List<Trigger>> = emptyMap()
    private val depthWarned = ConcurrentHashMap.newKeySet<String>()

    fun load(triggers: List<Trigger>) {
        byEvent = triggers.filter { it.enabled }.sortedBy { it.ref }.groupBy { it.on }
    }

    fun triggers(): List<Trigger> = byEvent.values.flatten()

    override fun observes(name: String): Boolean = byEvent.containsKey(name)

    override fun onGameEvent(frame: GameEventFrame) {
        val triggers = byEvent[frame.declaration.name] ?: return
        if (TriggerFrames.depth >= MAX_DEPTH) {
            if (depthWarned.add(frame.declaration.name)) {
                warn("triggers: '${frame.declaration.name}' skipped — more than $MAX_DEPTH Triggers nested (a chain that fires its own event?)")
            }
            return
        }
        val player = frame.player
        val args: Map<String, Any> = mapOf("event" to frame.context)
        TriggerFrames.with(frame) {
            for (trigger in triggers) {
                try {
                    run(trigger, frame, player.uniqueId, args)
                } catch (e: RuntimeException) {
                    warn("trigger ${trigger.ref} failed: $e")
                }
            }
        }
    }

    private fun run(trigger: Trigger, frame: GameEventFrame, playerId: UUID, args: Map<String, Any>) {
        val cooldownId = "triggers:${trigger.ref}"
        if (trigger.cooldownSeconds > 0 && cooldowns().isActive(cooldownId, playerId)) return
        if (trigger.conditions.isNotEmpty() && !conditions().test(frame.player, trigger.conditions, args)) return
        if (trigger.cooldownSeconds > 0) cooldowns().start(cooldownId, playerId, trigger.cooldownSeconds)
        actions().run(frame.player, trigger.chain, args, trigger.projectId)
    }

    companion object {
        const val MAX_DEPTH = 4
    }
}
