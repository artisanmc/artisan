package net.artisanmc.plugin.resourcepack

import net.artisanmc.plugin.text.LenientText
import net.kyori.adventure.bossbar.BossBar
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerQuitEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The boss bar of `OverlayApi.Slot.BOSS_BAR`: one per player, yellow and without notches, the
 * colour whose sprites Artisan's pack makes transparent (`BossBar.kt` of the pack), so only its
 * name, the slot's line, shows. Shown with the first layer, renamed in place, hidden with the last.
 * Called on the player's thread ([OverlaySlots] flushes there).
 */
class HudBossBars : Listener {

    private val bars = ConcurrentHashMap<UUID, BossBar>()

    fun send(player: Player, line: String) {
        if (line.isEmpty()) {
            bars.remove(player.uniqueId)?.let { player.hideBossBar(it) }
            return
        }
        val name = LenientText.parse(line)
        val bar = bars[player.uniqueId]
        if (bar != null) {
            bar.name(name)
            return
        }
        val created = BossBar.bossBar(name, 0f, BossBar.Color.YELLOW, BossBar.Overlay.PROGRESS)
        bars[player.uniqueId] = created
        player.showBossBar(created)
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        bars.remove(event.player.uniqueId)
    }
}
