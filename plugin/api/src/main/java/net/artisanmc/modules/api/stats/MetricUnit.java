package net.artisanmc.modules.api.stats;

import net.artisanmc.modules.api.annotations.Beta;

/**
 * How a {@link PlayerMetric}'s whole value reads, so a website formats it without knowing the
 * module: values are always whole numbers ({@code long}), never decimals.
 */
@Beta
public enum MetricUnit {
    /** A plain number: kills, quests completed, blocks mined. */
    COUNT,
    /** A duration in seconds: play time. */
    SECONDS,
    /** A number of days: a login streak. */
    DAYS,
    /** Money in hundredths of the server's currency: 12.50 is {@code 1250}. */
    CENTS
}
