package net.artisanmc.modules.api.menu;

import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * Opens and watches Artisan menus ({@code api.menus}).
 *
 * <p>Every method may be called from any thread. Opening and closing run on the player's thread
 * (their region's thread on Folia), scheduled if needed. Listeners are called on the player's
 * thread too; see {@link MenuOpenEvent}, {@link MenuClickEvent}, {@link MenuCloseEvent}, also
 * fired as Bukkit events.
 */
@Beta
public interface MenuApi {
    /** Inert default (tests / partial wiring). */
    MenuApi NOOP = new MenuApi() {
        @Override
        public boolean open(Player player, MenuRef menu, Map<String, Object> args) {
            return false;
        }

        @Override
        public boolean open(Player player, String ref, Map<String, Object> args) {
            return false;
        }

        @Override
        public boolean open(Player player, String ref) {
            return false;
        }

        @Override
        public void close(Player player) {}

        @Override
        public @Nullable MenuRef openMenu(Player player) {
            return null;
        }

        @Override
        public List<MenuRef> menus() {
            return List.of();
        }

        @Override
        public MenuSubscription onOpen(MenuOpenListener listener) {
            return () -> {};
        }

        @Override
        public MenuSubscription onClick(MenuClickListener listener) {
            return () -> {};
        }

        @Override
        public MenuSubscription onClose(MenuCloseListener listener) {
            return () -> {};
        }
    };

    /**
     * Opens {@code menu} for {@code player}, with {@code args} as the menu's context (like
     * {@code open_menu … with}). Returns false, opening nothing, when no menu matches.
     */
    boolean open(Player player, MenuRef menu, Map<String, Object> args);

    /** {@code ref} is {@code project:menu}, or a bare id looked up on the whole server. */
    boolean open(Player player, String ref, Map<String, Object> args);

    boolean open(Player player, String ref);

    /** Closes the player's Artisan menu, if one is open. */
    void close(Player player);

    /** The Artisan menu the player has open, or null. */
    @Nullable MenuRef openMenu(Player player);

    /** Every menu of every loaded project. */
    List<MenuRef> menus();

    MenuSubscription onOpen(MenuOpenListener listener);

    MenuSubscription onClick(MenuClickListener listener);

    MenuSubscription onClose(MenuCloseListener listener);
}
