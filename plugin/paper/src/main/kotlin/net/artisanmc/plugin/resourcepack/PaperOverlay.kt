package net.artisanmc.plugin.resourcepack

import net.artisanmc.modules.api.text.OverlayApi
import net.artisanmc.plugin.render.CHAR_ADVANCES
import net.artisanmc.plugin.render.OffsetEncoder
import net.artisanmc.plugin.text.LenientText
import net.kyori.adventure.key.Key
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.TextComponent
import net.kyori.adventure.text.format.NamedTextColor
import net.kyori.adventure.text.format.ShadowColor
import net.kyori.adventure.text.format.TextDecoration
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.entity.Player
import java.security.MessageDigest

/**
 * `api.getOverlay()`: a HUD with the pack's fonts. Text rises through `artisan:text_up<R>` and
 * drops through `artisan:text_y<6-R>_h8` (both always in the pack), images through
 * `artisan:overlay/<sha256(asset)>_<R>` (written for the (asset, rise) a module's kind declares,
 * `overlayImages.ts`), the pen moves with the `space` provider of `artisan:default`. Built as
 * components then written back as MiniMessage, so every tag closes. The layers go to [slots].
 *
 * [catalog] is read at call time: it is replaced on `/artisan reload`.
 */
class PaperOverlay(
    private val catalog: () -> AssetCatalog?,
    private val packs: PackLoadTracker,
    private val slots: OverlaySlots? = null,
) : OverlayApi {

    override fun width(miniMessage: String): Int = width(LenientText.parse(miniMessage), false)

    override fun raise(miniMessage: String, rise: Int): String =
        mm.serialize(Component.text().font(riseFont(rise)).append(LenientText.parse(miniMessage)).build())

    override fun move(px: Int): String = mm.serialize(space(px))

    override fun image(asset: String, rise: Int): String? {
        val entry = catalog()?.lookup(key(asset, rise)) ?: return null
        val font = entry.namespace?.let { Key.key(it) } ?: return null
        if (entry.slices.isEmpty()) return null
        val out = Component.text()
        var pen = 0
        entry.slices.forEachIndexed { i, content ->
            out.append(space(i * SLICE - pen))
            out.append(
                Component.text((GLYPH + i).toChar().toString()).font(font)
                    .color(NamedTextColor.WHITE).shadowColor(ShadowColor.none()),
            )
            // A bitmap glyph advances its content width + 1 (BitmapFont.Glyph.getAdvance()).
            pen = i * SLICE + content + 1
        }
        out.append(space(-pen))
        return mm.serialize(out.build())
    }

    override fun imageHeight(asset: String): Int = catalog()?.overlayImageHeight(asset) ?: -1

    override fun hasPack(player: Player): Boolean = packs.hasLoaded(player.uniqueId)

    override fun show(player: Player, slot: OverlayApi.Slot, layer: String, priority: Int, miniMessage: String) {
        slots?.show(player.uniqueId, slot, layer, priority, miniMessage)
    }

    override fun hide(player: Player, slot: OverlayApi.Slot, layer: String) {
        slots?.hide(player.uniqueId, slot, layer)
    }

    private fun space(px: Int): Component {
        if (px == 0) return Component.empty()
        val encoder = catalog()?.offsetEncoder() ?: OffsetEncoder.EMPTY
        return Component.text(encoder.encode(px)).font(DEFAULT_FONT)
    }

    private fun width(component: Component, inheritedBold: Boolean): Int {
        val bold = when (component.style().decoration(TextDecoration.BOLD)) {
            TextDecoration.State.TRUE -> true
            TextDecoration.State.FALSE -> false
            else -> inheritedBold
        }
        val own = (component as? TextComponent)?.content()?.codePoints()?.toArray()
            ?.sumOf { (CHAR_ADVANCES[it] ?: 1) + if (bold) 1 else 0 } ?: 0
        return own + component.children().sumOf { width(it, bold) }
    }

    companion object {
        private val mm = MiniMessage.miniMessage()
        private val DEFAULT_FONT = Key.key("artisan", "default")
        /** Columns per glyph of a cut image: the client drops a glyph over 256 px. */
        const val SLICE = 256
        private const val GLYPH = 0xE000

        /**
         * The font that draws text [rise] px higher, or lower when negative: `text_y<Y>_h8` puts
         * the top of the text at chest Y, the vanilla title's at Y 6 (`buildTextYFontJson`).
         */
        fun riseFont(rise: Int): Key {
            val r = rise.coerceIn(OverlayApi.MIN_RISE, OverlayApi.MAX_RISE)
            return if (r >= 0) Key.key("artisan", "text_up$r") else Key.key("artisan", "text_y${6 - r}_h8")
        }

        /** Same key as the editor's `overlayImageKey`. */
        fun key(asset: String, rise: Int): String {
            val hash = MessageDigest.getInstance("SHA-256").digest(asset.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
            return "overlay/${hash}_$rise"
        }
    }
}
