package net.artisanmc.modules.api.stats;

import net.artisanmc.modules.api.annotations.Beta;

/** Who a {@link StatEvent} is about. */
@Beta
public enum StatScope {
    /** A player: each record names one. */
    PLAYER,
    /** The server as a whole: records name no player. */
    SERVER
}
