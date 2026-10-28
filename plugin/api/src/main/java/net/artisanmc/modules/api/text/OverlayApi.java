package net.artisanmc.modules.api.text;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * Pieces of a HUD drawn in the action bar, above the hotbar ({@code api.getOverlay()}), with the
 * fonts of Artisan's resource pack. Every method returns MiniMessage, to concatenate and send
 * with {@code player.sendActionBar}; none needs Adventure types. The pen starts at the action
 * bar's left (the bar is centred on its whole width): {@link #move} shifts it, {@link #raise}
 * draws text above the line, {@link #image} an image of the pack.
 *
 * <p>Heights are a rise in px above the top of the action bar's text, 0 to 128. Widths follow
 * the vanilla font (Minecraft 1.21.4 advances, bold + 1 px a character); a player whose client
 * has another font, or a GUI scale that cuts the bar, sees it shifted. Only for a player for
 * whom {@link #hasPack} is true: anyone else sees missing characters.
 *
 * <p>Every method may be called from any thread.
 *
 * @since 2.20.0
 */
@Beta
public interface OverlayApi {

    /** Highest rise of {@link #raise} and {@link #image}. */
    int MAX_RISE = 128;

    /** Inert default (tests / partial wiring): no pack, nothing moves or rises. */
    OverlayApi NONE = new OverlayApi() {
        @Override
        public int width(String miniMessage) {
            return 0;
        }

        @Override
        public String raise(String miniMessage, int rise) {
            return miniMessage;
        }

        @Override
        public String move(int px) {
            return "";
        }

        @Override
        public @Nullable String image(String asset, int rise) {
            return null;
        }

        @Override
        public boolean hasPack(Player player) {
            return false;
        }
    };

    /** How far {@code miniMessage} moves the pen, in px: the sum of its characters' advances. */
    int width(String miniMessage);

    /**
     * {@code miniMessage} drawn {@code rise} px higher (font {@code artisan:text_up<rise>}), same
     * size and width. A rise out of 0..{@link #MAX_RISE} is clamped.
     */
    String raise(String miniMessage, int rise);

    /** Moves the pen by {@code px} (negative: to the left) without drawing anything. */
    String move(int px);

    /**
     * The image {@code asset} (a file of a Project's {@code assets/}, as a menu's {@code image.asset})
     * with its top {@code rise} px above the text's, without shadow; the pen ends where it started.
     * Null when the pack has no such image at that rise: the module's editor kind declares it
     * ({@code pack.images}, editor SDK 1.13), and the pack is built again when a Document changes.
     */
    @Nullable String image(String asset, int rise);

    /** Whether {@code player}'s client has loaded Artisan's resource pack (or the host's that merges it). */
    boolean hasPack(Player player);
}
