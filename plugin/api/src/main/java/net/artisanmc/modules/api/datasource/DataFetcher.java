package net.artisanmc.modules.api.datasource;

import java.util.List;
import java.util.Map;
import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.Nullable;

/**
 * Produces a data source's rows. See {@link DataSourceDeclaration#getFetcher()}.
 *
 * <p>{@code player} is null in preview mode (the editor's preview): return generic data
 * or throw {@link PlayerRequiredException}. Called on the server main thread at menu
 * render time: return fast (serve from an in-memory cache, no blocking I/O).
 */
@Stable
@FunctionalInterface
public interface DataFetcher {
    List<Map<String, Object>> fetch(@Nullable Player player, Map<String, Object> params);
}
