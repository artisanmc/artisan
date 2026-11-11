package net.artisanmc.plugin.database

/**
 * A server's row in `artisan_servers` (`id`, the `server_id` column of every suite table). Not the
 * **server id** of the glossary, which is the UUID the hub and the editor name a server by: the row
 * is the database's own key for it, resolved by [ServerRegistry.rowId].
 */
@JvmInline
value class ServerRow(val value: Int)
