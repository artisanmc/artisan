package net.artisanmc.modules.api.database;

import javax.sql.DataSource;
import net.artisanmc.modules.api.annotations.Beta;
import org.bukkit.plugin.Plugin;

/**
 * One connection pool per plugin over a database shared by the whole suite ({@code api.database}):
 * prefix your tables. The plugin brings its own access layer and migrations.
 */
@Beta
public interface DatabaseApi {
    /** Default when Artisan is not running: every call throws {@link IllegalStateException}. */
    DatabaseApi NONE = new DatabaseApi() {
        @Override
        public DatabaseDialect getDialect() {
            throw new IllegalStateException("No database: Artisan is not running");
        }

        @Override
        public DataSource dataSource(Plugin owner) {
            throw new IllegalStateException("No database: Artisan is not running");
        }
    };

    DatabaseDialect getDialect();

    /**
     * Blocks on the first call to check a connection: call it from {@code onEnable}.
     * The pool is closed when {@code owner} is disabled.
     */
    DataSource dataSource(Plugin owner);
}
