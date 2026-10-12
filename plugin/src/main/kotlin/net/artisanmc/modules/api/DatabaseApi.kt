package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.plugin.Plugin
import javax.sql.DataSource

/**
 * One connection pool per plugin over a database shared by the whole suite:
 * prefix your tables. The plugin brings its own access layer and migrations.
 */
@Beta
interface DatabaseApi {
    val dialect: DatabaseDialect

    /**
     * Blocks on the first call to check a connection: call it from `onEnable`.
     * The pool is closed when [owner] is disabled.
     */
    fun dataSource(owner: Plugin): DataSource

    companion object {
        @JvmField
        val NONE: DatabaseApi = object : DatabaseApi {
            override val dialect: DatabaseDialect get() = throw IllegalStateException("No database: Artisan is not running")
            override fun dataSource(owner: Plugin): DataSource = throw IllegalStateException("No database: Artisan is not running")
        }
    }
}
