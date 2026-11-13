package net.artisanmc.modules.api.scene;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.block.data.BlockData;
import org.bukkit.inventory.ItemStack;

import java.util.Objects;

/**
 * One piece of a scene, drawn by one display entity per viewer. Its {@link #key()} names it
 * within the scene, so that the next {@link ScenesApi#show} updates it instead of respawning it.
 *
 * @since 1.2.0
 */
@Beta
public sealed interface SceneElement permits SceneElement.Text, SceneElement.Item, SceneElement.Block, SceneElement.Hitbox {

    /** Unique within its scene: {@code [a-z0-9_.-]+}. */
    String key();

    SceneTransform transform();

    /** How an element faces its viewer. */
    enum Billboard {
        /** As its transform turns it. */
        FIXED,
        /** Turns around the vertical axis to face the viewer (a sign on a post). */
        VERTICAL,
        /** Always faces the viewer (a name above a head). */
        CENTER
    }

    /**
     * MiniMessage text ({@code TextDisplay}). {@code background} is ARGB ({@code 0} for none,
     * {@link #DEFAULT_BACKGROUND} for the vanilla grey), {@code lineWidth} in px before it wraps.
     */
    record Text(String key, SceneTransform transform, String miniMessage, Billboard billboard,
                int background, boolean shadow, int lineWidth) implements SceneElement {

        /** The client's own translucent grey. */
        public static final int DEFAULT_BACKGROUND = 0x40000000;

        public Text {
            checkKey(key);
            Objects.requireNonNull(transform, "transform");
            Objects.requireNonNull(miniMessage, "miniMessage");
            Objects.requireNonNull(billboard, "billboard");
            if (lineWidth < 1) throw new IllegalArgumentException("lineWidth must be >= 1: " + lineWidth);
        }

        /** Facing the viewer, vanilla grey background, no shadow, 200 px lines. */
        public static Text of(String key, SceneTransform transform, String miniMessage) {
            return new Text(key, transform, miniMessage, Billboard.CENTER, DEFAULT_BACKGROUND, false, 200);
        }
    }

    /** An item ({@code ItemDisplay}), its model centred on the transform's point. */
    record Item(String key, SceneTransform transform, ItemStack item, Billboard billboard) implements SceneElement {
        public Item {
            checkKey(key);
            Objects.requireNonNull(transform, "transform");
            Objects.requireNonNull(billboard, "billboard");
            item = item.clone();
        }

        /** Facing the viewer. */
        public static Item of(String key, SceneTransform transform, ItemStack item) {
            return new Item(key, transform, item, Billboard.CENTER);
        }
    }

    /**
     * A block ({@code BlockDisplay}). Unlike text and items, a block is drawn from its north-west
     * bottom corner: offset it by {@code -scale / 2} on x and z to centre it.
     */
    record Block(String key, SceneTransform transform, BlockData block) implements SceneElement {
        public Block {
            checkKey(key);
            Objects.requireNonNull(transform, "transform");
            block = block.clone();
        }
    }

    /**
     * An area the viewer aims at, drawn by nothing: {@link ScenesApi#aimed} answers which one the
     * viewer's crosshair is on. A vertical rectangle {@code width} × {@code height} blocks (times the
     * transform's scale), centred across on its point with its bottom there, turned by the
     * transform's yaw: the area a {@link Billboard#FIXED} text of that size covers. Seen from any
     * side.
     *
     * @since 1.2.0
     */
    record Hitbox(String key, SceneTransform transform, double width, double height) implements SceneElement {
        public Hitbox {
            checkKey(key);
            Objects.requireNonNull(transform, "transform");
            if (!(width > 0) || !(height > 0) || width > 64 || height > 64) {
                throw new IllegalArgumentException("hitbox size must be in (0, 64]: " + width + " × " + height);
            }
        }
    }

    private static void checkKey(String key) {
        if (key == null || !key.matches("[a-z0-9_.-]+")) {
            throw new IllegalArgumentException("element key must match [a-z0-9_.-]+: " + key);
        }
    }
}
