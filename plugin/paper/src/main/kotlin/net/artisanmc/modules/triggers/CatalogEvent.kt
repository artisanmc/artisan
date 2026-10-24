package net.artisanmc.modules.triggers

import net.artisanmc.modules.api.gameevent.GameEventDeclaration
import net.artisanmc.modules.api.gameevent.GameEventFrame
import net.artisanmc.modules.api.gameevent.GameEventRegistry
import net.artisanmc.modules.api.text.TextApi
import org.bukkit.entity.Player
import org.bukkit.event.Cancellable
import org.bukkit.event.Event

/**
 * One Bukkit event of the core catalog (ADR `triggers-and-variables` §2): the Game event it
 * declares, how to read its player and its context, and how to apply the effects a Trigger wrote.
 * Cancellation is applied here for every cancellable entry; [apply] only writes the effects.
 *
 * [type] is checked on every call: a Bukkit subclass without its own handler list (CraftItemEvent,
 * PlayerDeathEvent) shares its parent's, so the listener also sees the parent's other events.
 */
internal class CatalogEvent<E : Event>(
    val type: Class<E>,
    val declaration: GameEventDeclaration,
    /** False only where the event's own cancelled state needs reading by hand ([accept]). */
    val ignoreCancelled: Boolean = true,
    private val accept: (E) -> Boolean = { true },
    private val player: (E) -> Player?,
    private val context: (E) -> Map<String, Any?>,
    private val apply: (E, GameEventFrame, TextApi) -> Unit = { _, _, _ -> },
) {
    fun handle(event: Event, events: GameEventRegistry, text: TextApi) {
        if (!type.isInstance(event)) return
        if (!events.isObserved(declaration.name)) return
        val e = type.cast(event)
        if (!accept(e)) return
        val who = player(e) ?: return
        val frame = events.fire(declaration.name, who, context(e))
        // Never un-cancel: only a `true` is ever written.
        if (frame.isCancelled && e is Cancellable) e.isCancelled = true
        if (frame.effects.isNotEmpty()) apply(e, frame, text)
    }
}
