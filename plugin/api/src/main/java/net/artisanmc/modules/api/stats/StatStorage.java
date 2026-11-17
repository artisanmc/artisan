package net.artisanmc.modules.api.stats;

import net.artisanmc.modules.api.annotations.Beta;

/** Where a {@link StatEvent}'s records go. */
@Beta
public enum StatStorage {
    /** Summed per player, dimensions and hour: for what happens in bulk (clicks, commands). */
    BUCKETED,
    /** One row per occurrence, with its details: for what matters one by one (a session, a purchase). */
    RAW,
    /** Both: quick counts and the detail. */
    BOTH;

    public boolean bucketed() {
        return this != RAW;
    }

    public boolean raw() {
        return this != BUCKETED;
    }
}
