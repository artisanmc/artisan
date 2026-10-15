package net.artisanmc.modules.api;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * Answers {@code %namespace_<key>%}, called on the viewing player's thread at every render:
 * read from memory, never block. {@code player} is null only when PlaceholderAPI asks for an
 * offline player. Return null for an unknown key: the token then stays as written.
 */
@Beta
@FunctionalInterface
public interface PlaceholderResolver {
    @Nullable String resolve(@Nullable Player player, String key);
}
