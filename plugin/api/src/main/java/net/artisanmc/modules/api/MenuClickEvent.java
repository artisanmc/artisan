package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;
import org.bukkit.event.HandlerList;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.player.PlayerEvent;

/**
 * A click in an open menu, fired on the tick after the click, before its actions run.
 * {@link #getSlot()} is the raw slot (the menu's slots first, then the player's inventory);
 * {@link #hasActions()} says whether the menu defines actions for this slot and click.
 * Cancelling skips those actions; the click itself never moves items.
 */
@Beta
public final class MenuClickEvent extends PlayerEvent implements Cancellable {
    private static final HandlerList HANDLERS = new HandlerList();

    private final MenuRef menu;
    private final int slot;
    private final ClickType click;
    private final boolean hasActions;
    private boolean cancelled;

    public MenuClickEvent(Player player, MenuRef menu, int slot, ClickType click, boolean hasActions) {
        super(player);
        this.menu = menu;
        this.slot = slot;
        this.click = click;
        this.hasActions = hasActions;
    }

    public MenuRef getMenu() {
        return menu;
    }

    public int getSlot() {
        return slot;
    }

    public ClickType getClick() {
        return click;
    }

    public boolean hasActions() {
        return hasActions;
    }

    @Override
    public boolean isCancelled() {
        return cancelled;
    }

    @Override
    public void setCancelled(boolean cancel) {
        this.cancelled = cancel;
    }

    @Override
    public HandlerList getHandlers() {
        return HANDLERS;
    }

    public static HandlerList getHandlerList() {
        return HANDLERS;
    }
}
