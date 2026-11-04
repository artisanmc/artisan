package net.artisanmc.modules.api.scene;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;

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
 * <p>The content is already the viewer's: placeholders, conditions and language are resolved by
 * the caller. Every method may be called from any thread; the entities change on the thread that
 * owns them.
 *
 * @since 1.1.0
 */
@Beta
public interface ScenesApi {

    /** The most elements of one scene: each one is an entity per viewer. */
    int MAX_ELEMENTS = 64;

    /** Inert default (tests / partial wiring): nothing is ever shown. */
    ScenesApi NONE = new ScenesApi() {
        @Override
        public boolean supports(Player viewer) {
            return false;
        }

        @Override
        public void show(Player viewer, String scene, SceneAnchor anchor, List<SceneElement> elements, int transitionTicks) {}

        @Override
        public void hide(Player viewer, String scene) {}

        @Override
        public boolean isShown(Player viewer, String scene) {
            return false;
        }
    };

    /**
     * Whether {@code viewer}'s client draws display entities: false for a Bedrock player (Geyser
     * translates them partly or not at all). A module falls back (chat, HUD) when false.
     */
    boolean supports(Player viewer);

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
}
