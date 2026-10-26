package net.artisanmc.plugin.database

import net.artisanmc.plugin.hub.McpClient
import net.artisanmc.plugin.hub.McpGrant
import net.artisanmc.plugin.hub.McpGrantStore
import java.time.Instant
import java.util.UUID

/** [McpGrantStore] on `artisan_mcp_*` ([McpGrantRows]): the hub's types to rows and back. */
internal class McpGrantSql(private val rows: McpGrantRows) : McpGrantStore {
    override fun putClient(client: McpClient) = rows.putClient(McpClientRow(client.id, client.name, client.redirectUris, client.createdAt)).let { }
    override fun client(id: String) = rows.client(id)?.let { McpClient(it.id, it.name, it.redirectUris, it.createdAt) }
    override fun purgeClients(before: Instant) = rows.purgeClients(before)
    override fun countClients() = rows.countClients()
    override fun insert(grant: McpGrant) = rows.insert(row(grant)).let { }
    override fun replace(old: McpGrant, new: McpGrant) = rows.replace(row(old), row(new))
    override fun find(credential: McpGrantStore.Credential, hash: String) = rows.find(
        when (credential) {
            McpGrantStore.Credential.CODE -> "code_hash"
            McpGrantStore.Credential.ACCESS -> "access_hash"
            McpGrantStore.Credential.REFRESH -> "refresh_hash"
        },
        hash,
    )?.let(::grant)
    override fun grants(playerId: UUID) = rows.grants(playerId).map(::grant)
    override fun delete(id: String) = rows.delete(id).let { }
    override fun touch(id: String, at: Instant) = rows.touch(id, at).let { }
    override fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) = rows.setPermissions(playerId, origin, permissions).let { }
    override fun deletePlayer(playerId: UUID, origin: String?) = rows.deletePlayer(playerId, origin)
    override fun purge(now: Instant) = rows.purge(now).let { }

    private fun row(g: McpGrant) = McpGrantRow(
        g.id, g.clientId, g.clientName, g.playerId, g.playerName, g.origin, g.permissions, g.createdAt, g.lastUsedAt,
        g.codeHash, g.codeChallenge, g.redirectUri, g.codeExpiresAt, g.accessHash, g.accessExpiresAt, g.refreshHash, g.refreshExpiresAt,
    )

    private fun grant(r: McpGrantRow) = McpGrant(
        r.id, r.clientId, r.clientName, r.playerId, r.playerName, r.origin, r.permissions, r.createdAt, r.lastUsedAt,
        r.codeHash, r.codeChallenge, r.redirectUri, r.codeExpiresAt, r.accessHash, r.accessExpiresAt, r.refreshHash, r.refreshExpiresAt,
    )
}
