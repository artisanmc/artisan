package net.artisanmc.modules.api.scene;

import net.artisanmc.modules.api.annotations.Beta;

/**
 * Where an element sits from its scene's anchor: an offset in blocks, a turn around the vertical
 * axis in degrees (clockwise seen from above, 0 facing south) and a uniform scale. A change between
 * two {@link ScenesApi#show} is animated by the client over the call's transition.
 *
 * @since 1.1.0
 */
@Beta
public record SceneTransform(double x, double y, double z, float yaw, float scale) {

    /** At the anchor, unturned, scale 1. */
    public static final SceneTransform ORIGIN = new SceneTransform(0, 0, 0, 0f, 1f);

    public SceneTransform {
        if (!(scale > 0f)) throw new IllegalArgumentException("scale must be > 0: " + scale);
    }

    /** The offset {@code (x, y, z)}, unturned, scale 1. */
    public static SceneTransform offset(double x, double y, double z) {
        return new SceneTransform(x, y, z, 0f, 1f);
    }

    public SceneTransform withScale(float scale) {
        return new SceneTransform(x, y, z, yaw, scale);
    }

    public SceneTransform withYaw(float yaw) {
        return new SceneTransform(x, y, z, yaw, scale);
    }
}
