package net.artisanmc.modules.api;

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
    private final InventoryCloseEvent.Reason reason;

    public MenuCloseEvent(Player player, MenuRef menu, InventoryCloseEvent.Reason reason) {
        super(player);
        this.menu = menu;
        this.reason = reason;
    }

    public MenuRef getMenu() {
        return menu;
    }

    public InventoryCloseEvent.Reason getReason() {
        return reason;
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLERS;
    }

    public static HandlerList getHandlerList() {
        return HANDLERS;
    }
}
