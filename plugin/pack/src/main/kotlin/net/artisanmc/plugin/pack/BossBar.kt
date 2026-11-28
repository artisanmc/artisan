package net.artisanmc.plugin.pack

/**
 * The boss bar Artisan draws a HUD in (`OverlayApi.Slot.BOSS_BAR`), port of `bossBar.ts`: a bar
 * of colour [HUD_COLOR] whose sprites the pack makes transparent, so that only the bar's name, the
 * HUD, shows. The colour is reserved: every bar of it loses its bar for a player with the pack.
 */
object BossBar {
    /** No vanilla boss uses it; `BossBar.Color.YELLOW` on the server. */
    const val HUD_COLOR = "yellow"

    private const val WIDTH = 182
    private const val HEIGHT = 5

    /** The two transparent sprites (background and progress, no notches), added to [files]. */
    fun files(files: MutableMap<String, ByteArray>) {
        val empty = Png.encode(RgbaImage(WIDTH, HEIGHT))
        val dir = "assets/minecraft/textures/gui/sprites/boss_bar"
        files["$dir/${HUD_COLOR}_background.png"] = empty
        files["$dir/${HUD_COLOR}_progress.png"] = empty
    }
}
