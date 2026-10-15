package net.artisanmc.modules.api;

import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;
import org.bukkit.event.HandlerList;
import org.bukkit.event.player.PlayerEvent;

/**
 * A menu is about to open for {@link #getPlayer()}. Cancelling opens nothing.
 * Passed to the {@link MenuApi#onOpen} listeners, then fired as a Bukkit event, on the
 * player's thread. A menu opened over another fires its open event, then the old window's
 * close (reason {@code OPEN_NEW}); a repaint (pagination, {@code set}) reopens the window the same way.
 */
@Beta
public final class MenuOpenEvent extends PlayerEvent implements Cancellable {
    private static final HandlerList HANDLERS = new HandlerList();

    private final MenuRef menu;
    private final Map<String, Object> args;
    private boolean cancelled;

    public MenuOpenEvent(Player player, MenuRef menu, Map<String, Object> args) {
        super(player);
        this.menu = menu;
        this.args = args;
    }

    public MenuRef getMenu() {
        return menu;
    }

    /** The context the menu opens with. */
    public Map<String, Object> getArgs() {
        return args;
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
