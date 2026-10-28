package net.artisanmc.modules.api.database;

import javax.sql.DataSource;
import net.artisanmc.modules.api.annotations.Stable;
import org.bukkit.plugin.Plugin;

/**
 * One connection pool per plugin over a database shared by the whole suite ({@code api.database}).
 * The plugin brings its own access layer and migrations, and names every table, index and
 * constraint it creates with {@link #tablePrefix(String)}: {@code tablePrefix("quests") + "quest"}.
 */
@Stable
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

        @Override
        public String getTablePrefix() {
            throw new IllegalStateException("No database: Artisan is not running");
        }

        @Override
        public String tablePrefix(String module) {
            throw new IllegalStateException("No database: Artisan is not running");
        }
    };

    DatabaseDialect getDialect();

    /**
     * Blocks on the first call to check a connection: call it from {@code onEnable}.
     * The pool is closed when {@code owner} is disabled.
     */
    DataSource dataSource(Plugin owner);

    /**
     * {@code database.table-prefix} of {@code environment.yml}, {@code artisan_} by default: in front
     * of every table of the suite. Lower-case letters, digits and {@code _}, ending with {@code _}.
     *
     * @throws IllegalArgumentException when the configured value is not a valid prefix
     * @since 2.9.0
     */
    String getTablePrefix();

    /**
     * {@code getTablePrefix() + module + "_"}, e.g. {@code artisan_quests_}: the start of every table
     * name of a plugin. {@code module} is one lower-case word (letters and digits), not one of
     * Artisan's own first segments ({@code servers}, {@code meta}, {@code versions}…), so two plugins
     * never share a name. Read it once in {@code onEnable}: it does not change before a restart.
     *
     * @throws IllegalArgumentException when {@code module} is not one word, or is reserved
     * @since 2.9.0
     */
    String tablePrefix(String module);
}
