package net.artisanmc.modules.api.gameevent;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * A text effect written by a Trigger ({@code set_event: {join_message: …}}), kept unresolved so
 * that each player who sees it reads it in their own language (ADR {@code triggers-and-variables}
 * §3 bis): a join message is rendered once per online player, a kick reason for the kicked one.
 * The templates ({@code {player}}, {@code {event.…}}) are those of the Trigger's player whoever
 * reads the text.
 */
@Beta
@FunctionalInterface
public interface EffectText {
    /** The MiniMessage text for {@code viewer}; null renders it in the project's default language (console). */
    String render(@Nullable Player viewer);
}
