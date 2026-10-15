package net.artisanmc.modules.api;

import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * What an {@link ActionHandler} knows of the chain it runs in: the player, the bound
 * arguments ({@code {name}} placeholders: the click's context inputs, the iterated row, the
 * caller's bindings), the language and the project the chain comes from.
 *
 * <p>A handler returns the context the next action of the chain runs with: itself, or a copy
 * carrying new bindings ({@link #withArgs}). The runtime's own context (pagination, navigation
 * history) stays internal to Artisan.
 */
@Beta
public interface ActionContext {
    Player getPlayer();

    /** The placeholder bindings; {@code player} is always resolvable even when absent here. */
    Map<String, Object> getArgs();

    /** The player's language ({@code en}, {@code fr}...). */
    String getLang();

    /** Project of the Document the chain comes from; null when run outside a project (API, command). */
    @Nullable String getProjectId();

    /** A copy of this context with {@code args} bound on top of the current ones. */
    ActionContext withArgs(Map<String, Object> args);
}
