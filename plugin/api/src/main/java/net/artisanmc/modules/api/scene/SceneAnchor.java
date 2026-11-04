package net.artisanmc.modules.api.scene;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.Location;
import org.bukkit.entity.Entity;

import java.util.Objects;

/**
 * Where a scene stands: its elements' {@link SceneTransform} is measured from this point, x to the
 * east, y up, z to the south, unless the transform turns them.
 *
 * @since 1.1.0
 */
@Beta
public sealed interface SceneAnchor permits SceneAnchor.Point, SceneAnchor.OnEntity {

    /** A fixed point of a world. */
    static SceneAnchor at(Location location) {
        return new Point(location.clone());
    }

    /**
     * {@code height} blocks above the feet of {@code entity}, following it as it moves. The scene
     * ends when the entity leaves the world (death, removal, chunk unload).
     */
    static SceneAnchor above(Entity entity, double height) {
        return new OnEntity(entity, height);
    }

    /** A fixed point; its world must be set. */
    record Point(Location location) implements SceneAnchor {
        public Point {
            Objects.requireNonNull(location.getWorld(), "location.world");
        }
    }

    /** Above an entity, following it. */
    record OnEntity(Entity entity, double height) implements SceneAnchor {
        public OnEntity {
            Objects.requireNonNull(entity, "entity");
        }
    }
}
