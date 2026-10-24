package net.artisanmc.modules.api.playercommand;

import java.util.List;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * The values offered when a sender completes an argument, computed at that moment: guild names,
 * the members of the sender's guild, the players of the network. Artisan keeps those that start
 * with what was typed (ignoring case), without duplicates, 100 at most.
 *
 * <p>Called on the thread Bukkit completes on (the main thread, or Paper's async completion
 * thread): it must be cheap and thread-safe, reading what the plugin holds in memory, never the
 * database. One that throws is logged and offers nothing.
 *
 * @since 2.14.0
 */
@Beta
@FunctionalInterface
public interface SuggestionProvider {
    List<String> suggest(SuggestionContext context);
}
