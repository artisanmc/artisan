package net.artisanmc.modules.api.text;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * A HUD drawn with the fonts of Artisan's resource pack ({@code api.getOverlay()}), in a
 * {@link Slot} of the player's screen that Artisan owns. A module puts a named layer there
 * ({@link #show}); Artisan draws every layer of the slot together, keeps them on screen and takes
 * them away ({@link #hide}). Two modules never overwrite each other.
 *
 * <p>A layer is MiniMessage built from the pieces below. It is drawn with the pen at the centre
 * of the slot and must leave it there: x is measured from the centre of the screen, and each
 * piece that moves the pen is balanced ({@link #image} comes back on its own; text drawn by
 * {@link #raise} advances by its {@link #width}, so follow it with {@code move(-width)}).
 *
 * <p>Heights are a rise in px from the top of the slot's text line: positive goes up, negative
 * down, {@link #MIN_RISE} to {@link #MAX_RISE}. Widths follow the vanilla font (Minecraft 1.21.4
 * advances, bold + 1 px a character); a player whose client has another font, or a GUI scale
 * that cuts the slot, sees it shifted. The server does not know the screen's width: a layer is
 * placed from the centre, never from a corner. Only for a player for whom {@link #hasPack} is
 * true: anyone else sees missing characters.
 *
 * <p>Every method may be called from any thread.
 *
 * @since 2.20.0
 */
@Beta
public interface OverlayApi {

    /** Highest rise of {@link #raise} and {@link #image}. */
    int MAX_RISE = 128;
    /** Lowest rise (the deepest drop) of {@link #raise} and {@link #image}. */
    int MIN_RISE = -166;

    /** Where a layer is drawn. More slots (the boss bar, the sidebar) come on the same contract. */
    enum Slot {
        /** Above the hotbar, centred: the action bar's line, which Artisan resends while a layer is shown. */
        ACTION_BAR
    }

    /** Inert default (tests / partial wiring): no pack, nothing moves, rises or shows. */
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

        @Override
        public void show(Player player, Slot slot, String layer, int priority, String miniMessage) {}

        @Override
        public void hide(Player player, Slot slot, String layer) {}
    };

    /** How far {@code miniMessage} moves the pen, in px: the sum of its characters' advances. */
    int width(String miniMessage);

    /**
     * {@code miniMessage} drawn {@code rise} px higher, or lower when negative (fonts
     * {@code artisan:text_up<rise>} and {@code artisan:text_y<y>_h8}), same size and width. A
     * rise out of {@link #MIN_RISE}..{@link #MAX_RISE} is clamped.
     */
    String raise(String miniMessage, int rise);

    /** Moves the pen by {@code px} (negative: to the left) without drawing anything. */
    String move(int px);

    /**
     * The image {@code asset} (a file of a Project's {@code assets/}, as a menu's {@code image.asset})
     * with its top {@code rise} px above the text's top (below when negative), without shadow; the
     * pen ends where it started. Null when the pack has no such image at that rise: the module's
     * editor kind declares it ({@code pack.images}, editor SDK 1.13), and the pack is built again
     * when a Document changes.
     */
    @Nullable String image(String asset, int rise);

    /** Whether {@code player}'s client has loaded Artisan's resource pack (or the host's that merges it). */
    boolean hasPack(Player player);

    /**
     * Shows {@code miniMessage} as the layer {@code layer} of {@code slot} for {@code player}, or
     * replaces it. Name the layer after the module ({@code conversations:hud}). Layers are drawn
     * by ascending {@code priority}, the highest on top; equal priorities in the order they first
     * showed. Artisan keeps the slot on screen while one layer is there.
     */
    void show(Player player, Slot slot, String layer, int priority, String miniMessage);

    /** Takes the layer away; the slot is cleared once it holds none. Unknown layer: nothing happens. */
    void hide(Player player, Slot slot, String layer);

    /**
     * A frame drawn by {@link #compose}: its MiniMessage, pen back at the centre, ready for
     * {@link #show}, and the images the pack lacks (left out of the frame).
     *
     * @since 2.21.0
     */
    record Composed(String miniMessage, List<String> missingImages) {
        public Composed {
            missingImages = List.copyOf(missingImages);
        }
    }

    /**
     * {@code layout} filled with {@code content}, as one layer's MiniMessage: each image at its
     * rise ({@link #image}), each row raised to its place ({@link #raise}), the pen brought back
     * to the centre after each. An image the pack lacks is left out and named in
     * {@link Composed#missingImages()}: a module that cannot do without it falls back to the chat.
     *
     * @since 2.21.0
     */
    default Composed compose(OverlayLayout layout, OverlayContent content) {
        OverlayPlan.Plan plan = OverlayPlan.plan(layout, content, this::width, this::imageHeight);
        Set<String> missing = new LinkedHashSet<>(plan.missing());
        StringBuilder out = new StringBuilder();
        for (OverlayPlan.Draw draw : plan.draws()) {
            if (draw.image()) {
                String image = image(draw.content(), draw.rise());
                if (image == null) {
                    missing.add(draw.content());
                    continue;
                }
                out.append(move(draw.x())).append(image).append(move(-draw.x()));
            } else {
                out.append(move(draw.x())).append(raise(draw.content(), draw.rise()))
                        .append(move(-(draw.x() + width(draw.content()))));
            }
        }
        return new Composed(out.toString(), new ArrayList<>(missing));
    }

    /**
     * The height in px of the image {@code asset} as the pack draws it, or -1 when the pack holds
     * it at no rise. Places an {@code image_slot} anchored by its bottom.
     *
     * @since 2.21.0
     */
    default int imageHeight(String asset) {
        return -1;
    }
}
