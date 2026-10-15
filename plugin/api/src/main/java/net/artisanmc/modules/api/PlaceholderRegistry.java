package net.artisanmc.modules.api;

import java.util.Set;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;

/**
 * Placeholders for menus ({@code api.placeholders}): a namespace {@code homes} answers every
 * {@code %homes_<key>%} in menu titles, names, lore, action text and conditions, without
 * PlaceholderAPI. Artisan resolves its own namespaces first, then hands the text to
 * PlaceholderAPI when it is installed.
 */
@Beta
public interface PlaceholderRegistry {
    /** Inert default (tests / partial wiring). */
    PlaceholderRegistry NOOP = new PlaceholderRegistry() {
        @Override
        public void register(String namespace, PlaceholderResolver resolver, boolean exposeToPapi) {}

        @Override
        public void register(String namespace, PlaceholderResolver resolver) {}

        @Override
        public void unregister(String namespace) {}

        @Override
        public Set<String> namespaces() {
            return Set.of();
        }

        @Override
        public String resolve(Player player, String text) {
            return text;
        }
    };

    /**
     * {@code namespace} is a lowercase identifier ({@code homes}, {@code shop2}: {@code [a-z][a-z0-9]*}).
     * With {@code exposeToPapi}, and PlaceholderAPI installed, the namespace is also registered as a
     * PlaceholderAPI expansion, so other plugins (scoreboards, chat) can show it. Throws
     * {@link IllegalArgumentException} for a malformed namespace, {@link IllegalStateException}
     * for one already registered.
     */
    void register(String namespace, PlaceholderResolver resolver, boolean exposeToPapi);

    /** Same, Artisan only. */
    void register(String namespace, PlaceholderResolver resolver);

    /** Removes the namespace (and its PlaceholderAPI expansion). Unknown namespaces are ignored. */
    void unregister(String namespace);

    Set<String> namespaces();

    /** {@code text} with Artisan's placeholders resolved for {@code player}, then PlaceholderAPI's if installed. */
    String resolve(Player player, String text);
}
