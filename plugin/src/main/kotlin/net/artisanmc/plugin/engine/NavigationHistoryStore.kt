package net.artisanmc.plugin.engine

import org.bukkit.entity.Player
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * A screen the player navigated through — a Menu (inventory) or a Dialog — with
 * the context it had when it was shown. `args` carries only the navigation args
 * (never the renderer's fetched `sourceArgs`), so restoring a screen re-binds and
 * re-fetches exactly like a fresh navigation.
 */
data class NavigationEntry(
    val kind: Kind,
    val id: String,
    val args: Map<String, Any> = emptyMap(),
    val pagination: Map<String, Int> = emptyMap(),
    val lang: String = "en",
) {
    enum class Kind { MENU, DIALOG }
}

/**
 * Map-like value whose bare rendering is [display] (the screen id) — so
 * `{previous_menu}` reads the id while `{previous_menu.id}` / `.title` read the
 * fields, mirroring the `BukkitValue` adapter used for players/worlds.
 */
class ScreenValue(
    private val fields: Map<String, Any?>,
    private val display: String,
) : Map<String, Any?> by fields {
    override fun toString(): String = display
}

/**
 * Per-player navigation history (LIFO) plus the screen currently shown.
 *
 * **Push** happens on an explicit navigation (`open_menu` / `open_dialog`): the
 * outgoing screen is pushed. **Back** (`open_previous_menu`) POPs the previous
 * entry and re-opens it **without** pushing the current one — so every back
 * strictly shrinks the stack and two screens can never ping-pong forever.
 *
 * Re-renders (`set_arg`, pagination) update [setCurrent] but never push, so the
 * history reflects real navigation, not every repaint.
 */
class NavigationHistoryStore(private val maxDepth: Int = 32) {
    private class State {
        val stack = ArrayDeque<NavigationEntry>()
        var current: NavigationEntry? = null
    }

    private val states = ConcurrentHashMap<UUID, State>()

    private fun state(player: Player): State = states.computeIfAbsent(player.uniqueId) { State() }

    @Synchronized
    fun setCurrent(player: Player, entry: NavigationEntry?) {
        state(player).current = entry
    }

    /** Pushes the screen currently shown (no-op when none is known). */
    @Synchronized
    fun pushCurrent(player: Player) {
        val s = state(player)
        val cur = s.current ?: return
        s.stack.addLast(cur)
        while (s.stack.size > maxDepth) s.stack.removeFirst()
    }

    /** Removes and returns the previous screen, or null when the stack is empty. */
    @Synchronized
    fun popPrevious(player: Player): NavigationEntry? =
        states[player.uniqueId]?.stack?.removeLastOrNull()

    /** The screen currently shown (the last one passed to [setCurrent]), if any. */
    @Synchronized
    fun current(player: Player): NavigationEntry? = states[player.uniqueId]?.current

    /** The screen that `open_previous_menu` would return to, without consuming it. */
    @Synchronized
    fun previous(player: Player): NavigationEntry? = states[player.uniqueId]?.stack?.lastOrNull()

    @Synchronized
    fun hasPrevious(player: Player): Boolean = states[player.uniqueId]?.stack?.isNotEmpty() == true

    @Synchronized
    fun clear(player: Player) {
        states.remove(player.uniqueId)
    }
}
