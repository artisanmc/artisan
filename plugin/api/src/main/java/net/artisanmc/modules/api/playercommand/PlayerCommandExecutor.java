package net.artisanmc.modules.api.playercommand;

import net.artisanmc.modules.api.annotations.Stable;

/** The behaviour of a {@link PlayerCommandDeclaration}, run once permission, conditions and cooldown pass. */
@Stable
@FunctionalInterface
public interface PlayerCommandExecutor {
    /** Runs on the sender's thread: the player's region thread on Folia, the global one for the console. */
    void execute(PlayerCommandContext context);
}
