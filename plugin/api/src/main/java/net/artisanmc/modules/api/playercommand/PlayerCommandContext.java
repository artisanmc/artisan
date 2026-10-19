package net.artisanmc.modules.api.playercommand;

import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/** One execution of a player command: who typed it and the parsed arguments. Built by Artisan. */
@Beta
public interface PlayerCommandContext {
    /** The declared id of the command that runs ({@code attribution:open}), whatever the admin named it. */
    String getCommandId();

    CommandSender getSender();

    /** The sender when it is a player, null for the console. */
    @Nullable Player getPlayer();

    /** The language Artisan speaks to the sender ({@code TranslationsApi.langOf}). */
    String getLanguage();

    /** The arguments by name, typed as {@link CommandArgument.Type} says; an omitted optional one is absent. */
    Map<String, Object> getArguments();

    /** The argument {@code name} as {@code type}, or null when omitted. */
    default <T> @Nullable T get(String name, Class<T> type) {
        Object value = getArguments().get(name);
        return type.isInstance(value) ? type.cast(value) : null;
    }
}
