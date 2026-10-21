package net.artisanmc.modules.api.menu;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.bukkit.event.HandlerList;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.player.PlayerEvent;

/**
 * A menu window closed. Fired from Bukkit's close event: do not open an inventory from the
 * listener, schedule it ({@code api.scheduler}) instead.
 */
@Beta
public final class MenuCloseEvent extends PlayerEvent {
    private static final HandlerList HANDLERS = new HandlerList();

    private final MenuRef menu;
    private final MenuCloseReason reason;

    /** @since 2.10.0 */
    public MenuCloseEvent(Player player, MenuRef menu, MenuCloseReason reason) {
        super(player);
        this.menu = menu;
        this.reason = reason;
    }

    /** @deprecated Paper only; use {@link #MenuCloseEvent(Player, MenuRef, MenuCloseReason)}. Kept, not removed. */
    @Deprecated
    public MenuCloseEvent(Player player, MenuRef menu, InventoryCloseEvent.Reason reason) {
        this(player, menu, MenuCloseReason.named(reason == null ? null : reason.name()));
    }

    public MenuRef getMenu() {
        return menu;
    }

    /** @since 2.10.0 */
    public MenuCloseReason getCloseReason() {
        return reason;
    }

    /**
     * Paper only: throws {@link NoClassDefFoundError} on Spigot.
     *
     * @deprecated use {@link #getCloseReason()}; kept, not removed
     */
    @Deprecated
    public InventoryCloseEvent.Reason getReason() {
        return InventoryCloseEvent.Reason.valueOf(reason.name());
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLERS;
    }

    public static HandlerList getHandlerList() {
        return HANDLERS;
    }
}
