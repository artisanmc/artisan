package net.artisanmc.modules.api.network;

import net.artisanmc.modules.api.annotations.Beta;

/** How a {@link NetworkApi#teleport} or {@link NetworkApi#connect} ended. */
@Beta
public enum TeleportResult {
    /** Placed on this server, or sent to the other one. */
    DONE,
    /** The player moved during the delay. */
    MOVED,
    /** The player left before the end of the delay. */
    OFFLINE,
    /** No running server of the network has that name. */
    UNKNOWN_SERVER,
    /** The location's world does not exist on this server. */
    UNKNOWN_WORLD,
    /** Anything else (logged). */
    FAILED
}
