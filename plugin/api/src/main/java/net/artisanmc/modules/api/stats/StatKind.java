package net.artisanmc.modules.api.stats;

import net.artisanmc.modules.api.annotations.Beta;

/** How a {@link StatEvent}'s values read. */
@Beta
public enum StatKind {
    /** Occurrences, and the sum of their values: added up over a period. */
    COUNTER,
    /** A sampled measure (players online): read as an average, a minimum or a maximum. */
    GAUGE
}
