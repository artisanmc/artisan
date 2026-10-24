package net.artisanmc.modules.api.gameevent;

import net.artisanmc.modules.api.annotations.Beta;

/**
 * How often a Game event fires on a busy server (ADR {@code triggers-and-variables}, admission rule
 * 3). There is no third class: an event that fires every tick or every move (movement, block
 * physics, chunk loads) is not admitted as a Game event at all.
 */
@Beta
public enum GameEventFrequency {
    /** A few times per player session: a join, a death, a world change. */
    RARE,
    /** At the pace of a player's own actions: a click, a block broken, an item dropped. */
    NORMAL;

    /** The wire value of the presence report: {@code rare}, {@code normal}. */
    public String wire() {
        return name().toLowerCase(java.util.Locale.ROOT);
    }
}
