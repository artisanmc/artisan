package net.artisanmc.modules.api.scene;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

import java.util.List;

/**
 * Interfaces drawn in the world for one player, with display entities ({@code api.getScenes()}):
 * text, items and blocks placed around an {@link SceneAnchor anchor}, seen by their viewer
 * alone. A module shows a named scene ({@link #show}) and Artisan owns the entities: it spawns
 * them, follows the anchor, animates a change and removes them. Two modules never touch each
 * other's entities.
 *
 * <p>A scene is named after its module ({@code conversations:npc_marker}). Showing it again with
 * the same name updates it in place: an element keeps its entity while its {@link SceneElement#key()
 * key} and type stay the same, and a change of its {@link SceneTransform} is interpolated over
 * {@code transitionTicks} (the client animates it, nothing is sent in between). An element whose key
 * disappears is removed, a new key is spawned. A new anchor respawns the scene.
 *
 * <p>Artisan takes a scene away by itself, without telling the module, when its viewer quits or
 * changes world (scenes of another world), when its anchor entity leaves the world (death, chunk
 * unload), when the module's plugin disables and when Artisan stops. The entities are never saved
 * with the chunk: a crash leaves none behind.
 *
 * <p>A Bedrock player sees the text elements only ({@link #support}).
 *
 * <p>A {@link SceneElement.Hitbox} draws nothing: it is an area the viewer can aim at with their
 * crosshair ({@link #aimed}), a choice to click for instance.
 *
 * <p>The content is already the viewer's: placeholders, conditions and language are resolved by
 * the caller. Every method may be called from any thread; the entities change on the thread that
 * owns them.
 *
 * @since 1.2.0
 */
@Beta
public interface ScenesApi {

    /** The most elements of one scene: each one is an entity per viewer. */
    int MAX_ELEMENTS = 64;

    /** What a viewer's client draws of a scene. */
    enum Support {
        /** Everything: Java Edition. */
        FULL,
        /**
         * {@link SceneElement.Text} only, as a floating name: a Bedrock player through Geyser. No
         * scale, rotation, background, line width nor animation; items and blocks are left out by
         * Artisan. A marker made of text works; a menu does not.
         */
        TEXT_ONLY,
        /** Nothing. */
        NONE
    }

    /** Inert default (tests / partial wiring): nothing is ever shown. */
    ScenesApi NONE = new ScenesApi() {
        @Override
        public Support support(Player viewer) {
            return Support.NONE;
        }

        @Override
        public void show(Player viewer, String scene, SceneAnchor anchor, List<SceneElement> elements, int transitionTicks) {}

        @Override
        public void hide(Player viewer, String scene) {}

        @Override
        public boolean isShown(Player viewer, String scene) {
            return false;
        }

        @Override
        public @Nullable String aimed(Player viewer, String scene) {
            return null;
        }
    };

    /**
     * What {@code viewer}'s client draws: {@link Support#FULL} on Java, {@link Support#TEXT_ONLY}
     * for a Bedrock player (Geyser translates a text display into a floating name and drops item
     * and block displays). A scene shown to a {@code TEXT_ONLY} viewer keeps its text elements
     * only; a module whose scene needs more falls back (chat, overlay, chest menu).
     */
    Support support(Player viewer);

    /** Whether {@code viewer} gets the whole scene: {@code support(viewer) == FULL}. */
    default boolean supports(Player viewer) {
        return support(viewer) == Support.FULL;
    }

    /**
     * Shows the scene {@code scene} to {@code viewer}, or updates it. {@code transitionTicks} (0 to
     * 200) is how long a moved, turned or scaled element takes to get there. More than
     * {@link #MAX_ELEMENTS} elements, or two with the same key: {@link IllegalArgumentException}.
     */
    void show(Player viewer, String scene, SceneAnchor anchor, List<SceneElement> elements, int transitionTicks);

    /** {@link #show(Player, String, SceneAnchor, List, int)} without transition. */
    default void show(Player viewer, String scene, SceneAnchor anchor, List<SceneElement> elements) {
        show(viewer, scene, anchor, elements, 0);
    }

    /** Takes the scene away. Unknown scene: nothing happens. */
    void hide(Player viewer, String scene);

    /** Whether {@code viewer} has the scene {@code scene} (shown, not yet taken away). */
    boolean isShown(Player viewer, String scene);

    /** How far {@link #aimed} looks, in blocks. */
    double AIM_RANGE = 8;

    /**
     * The key of the {@link SceneElement.Hitbox} of {@code scene} that {@code viewer}'s crosshair is
     * on (the nearest when several are, within {@link #AIM_RANGE}), or null. Computed by the server
     * from the eyes' position and direction, as the client sent them: call it from the viewer's
     * thread, typically on their move event (a turn of the head is one) to show what they aim at,
     * and on their click to take it. Blocks in between are not checked.
     *
     * @since 1.2.0
     */
    @Nullable String aimed(Player viewer, String scene);
}
