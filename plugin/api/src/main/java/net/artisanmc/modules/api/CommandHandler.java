package net.artisanmc.modules.api;

import java.util.Map;
import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.entity.Player;

/** Runs a module command. See {@link CommandDeclaration#getHandler()}. */
@Stable
@FunctionalInterface
public interface CommandHandler {
    void handle(Player player, Map<String, Object> args);
}
