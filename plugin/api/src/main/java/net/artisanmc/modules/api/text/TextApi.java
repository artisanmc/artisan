package net.artisanmc.modules.api.text;

import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.command.CommandSender;

/**
 * Text for players without Adventure types ({@code api.getText()}), so a plugin runs on Paper
 * and Spigot alike. Input is MiniMessage; {@code §} codes are accepted and converted. Malformed
 * text never throws: it degrades to plain text. Every method may be called from any thread.
 *
 * @since 2.10.0
 */
@Stable
public interface TextApi {
    /** Inert default (tests / partial wiring): sends and returns the text as given. */
    TextApi NOOP = new TextApi() {
        @Override
        public void send(CommandSender to, String miniMessage) {
            to.sendMessage(miniMessage);
        }

        @Override
        public String legacy(String miniMessage) {
            return miniMessage;
        }

        @Override
        public String plain(String miniMessage) {
            return miniMessage;
        }

        @Override
        public String fromLegacy(String legacy) {
            return legacy;
        }
    };

    /** Parses {@code miniMessage} and sends it to {@code to}. */
    void send(CommandSender to, String miniMessage);

    /**
     * {@code miniMessage} as a {@code §}-coded string ({@code §x§r§r§g§g§b§b} for a hex color),
     * for the Bukkit methods that take a String: item names and lore, inventory, boss bar and
     * title texts. Fonts, hover and click do not survive.
     */
    String legacy(String miniMessage);

    /** {@code miniMessage} without its formatting. */
    String plain(String miniMessage);

    /** A {@code §}-coded string, as Bukkit returns an item's name, as MiniMessage. */
    String fromLegacy(String legacy);
}
