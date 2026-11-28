package net.artisanmc.modules.huds

import net.artisanmc.modules.api.text.OverlayApi
import net.artisanmc.modules.api.text.OverlayContent
import net.artisanmc.plugin.render.LoreWrap
import org.bukkit.entity.Player
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * What the HUDs of the server show each player (ADR `server-huds` §2–4): for each HUD, whether it is
 * on (enabled, or shown by `show_hud` and not yet over), whether the player has the pack and passes
 * its `when`, and its texts resolved for them. A HUD is composed and sent only when what it would
 * draw changed since the last time; otherwise nothing leaves the server.
 *
 * Checked again: for one player at once on a change of Variable, join, pack loaded, `show_hud` /
 * `hide_hud` and reload ([update]); for each HUD of `refresh` > 0, at that period ([tick], called
 * every [PERIOD] ticks by one task per player). Every call for a player runs on that player's thread.
 *
 * @param later runs a task on the player's thread after a delay in ticks (nothing once they left).
 */
internal class HudRuntime(
    private val overlay: () -> OverlayApi,
    private val passes: (Player, Hud) -> Boolean,
    private val render: (Player, Hud, String) -> String,
    private val later: (Player, Long, () -> Unit) -> Unit,
    private val warn: (String) -> Unit,
) {
    /** One HUD as last drawn for a player: where, and the rows of each text layer. */
    private data class Drawn(val slot: OverlayApi.Slot, val layer: String, val rows: Map<String, List<String>>)

    private class State {
        val drawn = HashMap<String, Drawn>()
        /** `show_hud` in progress: ref → its token, which a later `show_hud` replaces (new duration). */
        val temporary = HashMap<String, Long>()
        /** Ticks counted by [tick], and when each HUD was last checked on that clock. */
        var clock = 0L
        val checked = HashMap<String, Long>()
        var looping = false
    }

    @Volatile private var huds: Map<String, Hud> = emptyMap()
    private val players = ConcurrentHashMap<UUID, State>()
    /** What was already reported once (missing images): not repeated at each frame. */
    private val reported = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var tokens = 0L
    @Volatile private var generation = 0

    val all: Collection<Hud> get() = huds.values

    /** Replaces the HUDs (a reload); each player's are checked again by the caller ([update]). */
    fun load(list: List<Hud>) {
        huds = list.associateBy { it.ref }
        reported.clear()
    }

    /**
     * The HUD that `ref` names: `project/id` as is; a bare id in [projectId] first, then the only
     * project that has one by that id.
     */
    fun resolve(ref: String, projectId: String?): Hud? {
        val current = huds
        current[ref]?.let { return it }
        if ('/' in ref) return null
        projectId?.let { current["$it/$ref"] }?.let { return it }
        return current.values.singleOrNull { it.id == ref }
    }

    /** Starts the player's [tick] loop if it is not running (join, enable, reload). */
    fun start(player: Player) {
        val state = players.getOrPut(player.uniqueId, ::State)
        if (state.looping) return
        state.looping = true
        val gen = generation
        loop(player, gen)
    }

    private fun loop(player: Player, gen: Int) {
        later(player, PERIOD) {
            val state = players[player.uniqueId]
            if (gen != generation || state == null || !player.isOnline) {
                state?.looping = false
                return@later
            }
            tick(player)
            loop(player, gen)
        }
    }

    /** The player left: nothing kept, nothing more scheduled for them. */
    fun forget(player: Player) {
        players.remove(player.uniqueId)
    }

    /** Stops every loop and takes every HUD away (module disabled). */
    fun stop(online: Collection<Player>) {
        generation++
        for (player in online) {
            val state = players[player.uniqueId] ?: continue
            state.drawn.values.forEach { overlay().hide(player, it.slot, it.layer) }
        }
        players.clear()
    }

    /** `show_hud`: [hud] on for [player], for [duration] ticks (≤ 0: until `hide_hud` or quit). */
    fun show(player: Player, hud: Hud, duration: Long) {
        val state = players.getOrPut(player.uniqueId, ::State)
        val token = ++tokens
        state.temporary[hud.ref] = token
        if (duration > 0) {
            later(player, duration) {
                val now = players[player.uniqueId] ?: return@later
                if (now.temporary[hud.ref] != token) return@later
                now.temporary.remove(hud.ref)
                update(player, setOf(hud.ref))
            }
        }
        update(player, setOf(hud.ref))
    }

    /** `hide_hud`: ends a `show_hud` of [hud]. A HUD on by itself (`enabled`) stays. */
    fun hide(player: Player, hud: Hud) {
        val state = players[player.uniqueId] ?: return
        if (state.temporary.remove(hud.ref) != null) update(player, setOf(hud.ref))
    }

    /** Whether [hud] is on for [player], whatever its conditions: enabled, or shown by `show_hud`. */
    fun isOn(player: Player, hud: Hud): Boolean =
        hud.enabled || players[player.uniqueId]?.temporary?.containsKey(hud.ref) == true

    /** Checks [only] (every HUD when null) for [player] now, and those drawn of a HUD that is gone. */
    fun update(player: Player, only: Set<String>? = null) {
        val state = players.getOrPut(player.uniqueId, ::State)
        val current = huds
        for ((ref, drawn) in state.drawn.entries.toList()) {
            val hud = current[ref]
            if (hud == null || hud.slot != drawn.slot) {
                overlay().hide(player, drawn.slot, drawn.layer)
                state.drawn.remove(ref)
            }
        }
        state.temporary.keys.retainAll(current.keys)
        for (hud in current.values) {
            if (only != null && hud.ref !in only) continue
            state.checked[hud.ref] = state.clock
            check(player, state, hud)
        }
    }

    /** [PERIOD] ticks went by: each HUD of `refresh` > 0 whose period is over is checked again. */
    fun tick(player: Player) {
        val state = players[player.uniqueId] ?: return
        state.clock += PERIOD
        val due = huds.values.filter { hud ->
            hud.refresh > 0 && state.clock - (state.checked[hud.ref] ?: Long.MIN_VALUE / 2) >= hud.refresh
        }
        if (due.isNotEmpty()) update(player, due.mapTo(HashSet()) { it.ref })
    }

    private fun check(player: Player, state: State, hud: Hud) {
        val api = overlay()
        val visible = isOn(player, hud) && api.hasPack(player) &&
            runCatching { passes(player, hud) }.getOrElse {
                report("${hud.ref}:when", "hud ${hud.ref}: its conditions failed — ${it.message}")
                false
            }
        if (!visible) {
            state.drawn.remove(hud.ref)?.let { api.hide(player, it.slot, it.layer) }
            return
        }
        val rows = hud.textLayers.associate { layer ->
            val template = hud.texts[layer.slot].orEmpty()
            val text = runCatching { render(player, hud, template) }.getOrElse { template }
            layer.slot to rows(text, layer.width, layer.lines)
        }
        val drawn = Drawn(hud.slot, hud.layer, rows)
        if (state.drawn[hud.ref] == drawn) return
        val content = OverlayContent.builder().apply { rows.forEach { (slot, r) -> text(slot, r) } }.build()
        val composed = api.compose(hud.layout, content)
        if (composed.missingImages.isNotEmpty()) {
            report(
                "${hud.ref}:images:${composed.missingImages}",
                "hud ${hud.ref}: the pack has no ${composed.missingImages.joinToString()} (drawn without)",
            )
        }
        api.show(player, hud.slot, hud.layer, hud.priority, composed.miniMessage)
        state.drawn[hud.ref] = drawn
    }

    private fun report(key: String, message: String) {
        if (reported.add(key)) warn(message)
    }

    companion object {
        /** Ticks between two [tick]s: the finest `refresh` ([Hud.MIN_REFRESH]). */
        const val PERIOD = Hud.MIN_REFRESH.toLong()

        /**
         * The rows of a text layer: each line of [text] (`\n` or `<newline>`/`<br>`) wrapped to
         * [width] px, at most [lines] rows; what does not fit is left out.
         */
        fun rows(text: String, width: Int, lines: Int): List<String> {
            if (text.isEmpty()) return emptyList()
            val max = lines.coerceAtLeast(1)
            return text.split(NEWLINE)
                .flatMap { LoreWrap.wrap(it, width) }
                .take(max)
        }

        private val NEWLINE = Regex("""\n|<newline>|<br>""")
    }
}
