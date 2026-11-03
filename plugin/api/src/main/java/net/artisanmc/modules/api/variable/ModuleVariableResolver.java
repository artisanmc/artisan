package net.artisanmc.modules.api.variable;

import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * Computes a module Variable's value at each read. Called on the thread that owns {@code player}
 * (main thread on Paper, the player's region on Folia), the same contract as a placeholder
 * resolver: it reads the module's memory and never blocks.
 */
@Beta
@FunctionalInterface
public interface ModuleVariableResolver {
    /**
     * @param player the player the value is read for (a {@link VariableScope#SERVER} variable ignores it).
     * @param key the key, as typed, for a keyed variable; null for one without a key.
     * @return the value, of the declared {@link VariableType}; null when absent.
     */
    @Nullable Object resolve(Player player, @Nullable String key);
}
