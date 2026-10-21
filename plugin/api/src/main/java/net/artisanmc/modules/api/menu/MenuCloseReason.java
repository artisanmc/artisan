package net.artisanmc.modules.api.menu;

import net.artisanmc.modules.api.annotations.Beta;

/**
 * Why a menu window closed ({@link MenuCloseEvent#getCloseReason()}). Paper reports it; Spigot
 * does not, so there it is always {@link #UNKNOWN}.
 *
 * @since 2.10.0
 */
@Beta
public enum MenuCloseReason {
    /** Not reported, or a reason this version does not know. */
    UNKNOWN,
    /** The player moved too far, or teleported. */
    TELEPORT,
    /** The player can no longer use the inventory (its block is gone). */
    CANT_USE,
    /** The inventory's chunk unloaded. */
    UNLOADED,
    /** Another inventory opened in its place. */
    OPEN_NEW,
    /** The player closed it. */
    PLAYER,
    /** The player left the server. */
    DISCONNECT,
    /** The player died. */
    DEATH,
    /** A plugin closed it. */
    PLUGIN;

    /** The value named {@code name}, {@link #UNKNOWN} for null or an unknown name. */
    public static MenuCloseReason named(String name) {
        if (name == null) return UNKNOWN;
        for (MenuCloseReason reason : values()) {
            if (reason.name().equals(name)) return reason;
        }
        return UNKNOWN;
    }
}
