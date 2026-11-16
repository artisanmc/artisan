package net.artisanmc.modules.api.stats;

import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.annotations.Beta;

/**
 * A figure a module computes on demand for its statistics tab ({@link StatsApi#declareQuery}): a
 * present state that no event records, read from the module's own tables ("how many players are
 * stopped at each stage right now").
 *
 * <p>Called off the game threads, never on a player's tick: read the database, not the world.
 * Artisan keeps the rows for the declared time, so a tab opened by several admins asks once.
 */
@Beta
@FunctionalInterface
public interface StatQuery {
    /**
     * The rows of the answer, each a map of JSON values (strings, numbers, booleans, lists, maps).
     *
     * @param params what the tab asks with ({@code group=daily}); never null
     * @throws Exception the editor shows the tab's figure as unavailable
     */
    List<Map<String, Object>> rows(Map<String, String> params) throws Exception;
}
