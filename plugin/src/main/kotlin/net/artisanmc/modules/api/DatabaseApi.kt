package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.plugin.Plugin
import javax.sql.DataSource

/**
 * Database lent by Artisan to the plugins of the suite (ADR
 * `suite-foundation-database`): the admin sets the credentials once in
 * `plugins/Artisan/environment.yml`, and each plugin gets its **own** connection
 * pool, so a plugin leaking connections never starves another.
 *
 * Only `javax.sql.DataSource` crosses the boundary: the pool and the JDBC
 * drivers stay inside Artisan, and a plugin brings its own access layer (JDBC,
 * JDBI…) and its own migrations. Every plugin of the suite shares one database
 * (the configured MySQL/MariaDB one, or a single H2 file), so a plugin prefixes
 * its tables.
 */
@Beta
interface DatabaseApi {
    /** Dialect configured by the admin. */
    val dialect: DatabaseDialect

    /**
     * The pool of [owner], opened on the first call and returned as is afterwards.
     * Closed when [owner] is disabled: call it again from the next `onEnable`.
     * Opening it checks a connection, so the first call blocks briefly: make it
     * from `onEnable`, not from a hot path.
     *
     * @throws IllegalStateException when the database is unreachable or misconfigured
     */
    fun dataSource(owner: Plugin): DataSource

    companion object {
        /** Inert default (tests / partial wiring): every call throws. */
        @JvmField
        val NONE: DatabaseApi = object : DatabaseApi {
            override val dialect: DatabaseDialect get() = throw IllegalStateException("No database: Artisan is not running")
            override fun dataSource(owner: Plugin): DataSource = throw IllegalStateException("No database: Artisan is not running")
        }
    }
}
