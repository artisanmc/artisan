package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Stable;
import org.jetbrains.annotations.Nullable;

/**
 * Thrown by a fetcher that cannot produce meaningful rows without a real player
 * (preview mode calls it with {@code player = null}). Surfaced to the editor as the
 * typed {@code player_required} preview error.
 */
@Stable
public class PlayerRequiredException extends RuntimeException {
    public PlayerRequiredException() {
        this(null);
    }

    public PlayerRequiredException(@Nullable String message) {
        super(message);
    }
}
