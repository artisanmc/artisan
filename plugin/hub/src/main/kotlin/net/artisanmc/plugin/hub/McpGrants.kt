package net.artisanmc.plugin.hub

import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** An AI client that registered itself (RFC 7591): Claude, ChatGPT, an IDE. Public, no secret: PKCE stands for it. */
data class McpClient(val id: String, val name: String, val redirectUris: List<String>, val createdAt: Instant)

/**
 * A player's yes to one client (ADR `mcp-server`): what the client acts as, and its credentials,
 * kept as hashes. A code until [McpGrants.exchange] trades it, then an access token and a refresh
 * token, both rotated on each refresh. [permissions] follow the player's, like an editor session's,
 * less configuring the hub. Publishing is the player's only while [allowPublish]: tokens are
 * "draft only" until the player allows the app to deploy, at consent or in Settings → AI apps.
 */
data class McpGrant(
    val id: String,
    val clientId: String,
    val clientName: String,
    val playerId: UUID,
    val playerName: String,
    /** The server the player approved from: its permission reports update this grant. */
    val origin: String,
    val permissions: Set<String>,
    val createdAt: Instant,
    val lastUsedAt: Instant,
    val codeHash: String? = null,
    val codeChallenge: String? = null,
    val redirectUri: String? = null,
    val codeExpiresAt: Instant? = null,
    val accessHash: String? = null,
    val accessExpiresAt: Instant? = null,
    val refreshHash: String? = null,
    val refreshExpiresAt: Instant? = null,
    val allowPublish: Boolean = false,
) {
    /** What the app acts with: the player's permissions, publishing only when the player allowed it. */
    val effectivePermissions: Set<String>
        get() = if (allowPublish) permissions else permissions - EditorPermissions.PUBLISH

    fun can(permission: String) = permission in effectivePermissions
}

/** Where clients and grants live: the suite database, else memory. Hashes only, a leaked row opens nothing. */
interface McpGrantStore {
    fun putClient(client: McpClient)
    fun client(id: String): McpClient?
    /** Removes clients registered before [before] that no grant names; the number removed. */
    fun purgeClients(before: Instant): Int
    fun countClients(): Int
    fun insert(grant: McpGrant)
    /** Replaces [old] by [new] if its credentials did not move meanwhile: a code or refresh token is used once. */
    fun replace(old: McpGrant, new: McpGrant): Boolean
    fun find(credential: Credential, hash: String): McpGrant?
    fun grants(playerId: UUID): List<McpGrant>
    fun delete(id: String)
    fun touch(id: String, at: Instant)
    fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>)
    /** Allows or forbids grant [id] of [playerId] to deploy; false when no such grant. */
    fun setPublish(playerId: UUID, id: String, allow: Boolean): Boolean
    fun deletePlayer(playerId: UUID, origin: String?): Int
    /** Removes grants nothing can use any more: code and refresh token both expired. */
    fun purge(now: Instant)

    enum class Credential { CODE, ACCESS, REFRESH }
}

/** The store of a hub without database, and of the tests. */
class MemoryMcpGrantStore : McpGrantStore {
    private val clients = ConcurrentHashMap<String, McpClient>()
    private val grants = ConcurrentHashMap<String, McpGrant>()

    override fun putClient(client: McpClient) { clients[client.id] = client }
    override fun client(id: String) = clients[id]
    override fun purgeClients(before: Instant): Int {
        val used = grants.values.map { it.clientId }.toSet()
        val stale = clients.values.filter { it.createdAt.isBefore(before) && it.id !in used }
        stale.forEach { clients.remove(it.id) }
        return stale.size
    }
    override fun countClients() = clients.size
    override fun insert(grant: McpGrant) { grants[grant.id] = grant }
    @Synchronized override fun replace(old: McpGrant, new: McpGrant): Boolean {
        val current = grants[old.id] ?: return false
        if (current.codeHash != old.codeHash || current.refreshHash != old.refreshHash) return false
        grants[old.id] = new
        return true
    }
    override fun find(credential: McpGrantStore.Credential, hash: String) = grants.values.firstOrNull {
        when (credential) {
            McpGrantStore.Credential.CODE -> it.codeHash == hash
            McpGrantStore.Credential.ACCESS -> it.accessHash == hash
            McpGrantStore.Credential.REFRESH -> it.refreshHash == hash
        }
    }
    override fun grants(playerId: UUID) = grants.values.filter { it.playerId == playerId }.sortedBy { it.createdAt }
    override fun delete(id: String) { grants.remove(id) }
    override fun touch(id: String, at: Instant) { grants.computeIfPresent(id) { _, g -> g.copy(lastUsedAt = at) } }
    override fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) {
        grants.replaceAll { _, g -> if (g.playerId == playerId && g.origin == origin) g.copy(permissions = permissions) else g }
    }
    override fun setPublish(playerId: UUID, id: String, allow: Boolean): Boolean =
        grants.computeIfPresent(id) { _, g -> if (g.playerId == playerId) g.copy(allowPublish = allow) else g }?.let { it.playerId == playerId } ?: false
    override fun deletePlayer(playerId: UUID, origin: String?): Int {
        val mine = grants.values.filter { it.playerId == playerId && (origin == null || it.origin == origin) }
        mine.forEach { grants.remove(it.id) }
        return mine.size
    }
    override fun purge(now: Instant) {
        grants.values.removeIf { g ->
            (g.codeExpiresAt == null || !g.codeExpiresAt.isAfter(now)) && (g.refreshExpiresAt == null || !g.refreshExpiresAt.isAfter(now))
        }
    }
}

/**
 * OAuth 2.1 for the MCP endpoint (ADR `mcp-server`): client registration, the player's consent,
 * authorization codes with PKCE (S256 only), access and refresh tokens. The player approves in
 * the editor, signed in as usual: a client never sees a cookie, and gets at most what the player
 * can do, less configuring the hub, and less publishing unless the player allowed it.
 */
class McpGrants(
    private val store: McpGrantStore = MemoryMcpGrantStore(),
    private val clock: Clock = Clock.systemUTC(),
    private val accessTtl: Duration = Duration.ofHours(1),
    private val refreshTtl: Duration = Duration.ofDays(30),
    private val codeTtl: Duration = Duration.ofSeconds(60),
) {
    private val random = SecureRandom()

    /** Tokens handed out by [exchange] and [refresh]. */
    data class Tokens(val accessToken: String, val refreshToken: String, val expiresIn: Long)

    sealed interface Registration {
        data class Registered(val client: McpClient) : Registration
        data class Refused(val error: String, val description: String) : Registration
    }

    /** RFC 7591: [redirectUris] are https, or http on the loopback (desktop clients). */
    fun register(name: String, redirectUris: List<String>): Registration {
        if (redirectUris.isEmpty() || redirectUris.size > 10) return Registration.Refused("invalid_redirect_uri", "1 to 10 redirect_uris")
        redirectUris.firstOrNull { !validRedirect(it) }?.let { return Registration.Refused("invalid_redirect_uri", "not allowed: $it") }
        val now = clock.instant()
        // Registration is open to anyone: a client never authorized does not stay.
        if (store.countClients() >= MAX_CLIENTS) store.purgeClients(now.minus(UNUSED_CLIENT))
        if (store.countClients() >= MAX_CLIENTS) return Registration.Refused("temporarily_unavailable", "too many clients")
        val client = McpClient("mcp_" + token(), name.trim().take(80).ifEmpty { "MCP client" }, redirectUris, now)
        store.putClient(client)
        return Registration.Registered(client)
    }

    fun client(id: String?): McpClient? = id?.takeIf { it.isNotEmpty() }?.let(store::client)

    /**
     * [session]'s consent to [client]: the code to send back to [redirectUri]. Null: the session cannot edit.
     * [publish] lets the app deploy, kept only when the player can publish themselves.
     */
    fun approve(session: EditorSession, client: McpClient, redirectUri: String, codeChallenge: String, publish: Boolean = false): String? {
        if (!session.can(EditorPermissions.EDIT) || redirectUri !in client.redirectUris || !CHALLENGE.matches(codeChallenge)) return null
        val now = clock.instant()
        store.purge(now)
        val code = token()
        store.insert(
            McpGrant(
                id = UUID.randomUUID().toString(), clientId = client.id, clientName = client.name,
                playerId = session.playerId, playerName = session.playerName, origin = session.origin,
                permissions = session.permissions - EditorPermissions.CONFIG,
                createdAt = now, lastUsedAt = now,
                codeHash = hash(code), codeChallenge = codeChallenge, redirectUri = redirectUri, codeExpiresAt = now.plus(codeTtl),
                allowPublish = publish && session.can(EditorPermissions.PUBLISH),
            ),
        )
        return code
    }

    /** RFC 6749 §4.1.3 with PKCE: null is `invalid_grant`, whatever was wrong. */
    fun exchange(code: String, clientId: String, redirectUri: String, verifier: String): Tokens? {
        val grant = store.find(McpGrantStore.Credential.CODE, hash(code)) ?: return null
        val now = clock.instant()
        val fits = grant.clientId == clientId && grant.redirectUri == redirectUri && grant.codeExpiresAt?.isAfter(now) == true &&
            VERIFIER.matches(verifier) && grant.codeChallenge == challenge(verifier)
        if (!fits) {
            // A code is tried once: a wrong verifier burns it.
            store.delete(grant.id)
            return null
        }
        return issue(grant, grant.copy(codeHash = null, codeChallenge = null, codeExpiresAt = null), now)
    }

    /** Rotates both tokens; null is `invalid_grant`. */
    fun refresh(refreshToken: String, clientId: String): Tokens? {
        val grant = store.find(McpGrantStore.Credential.REFRESH, hash(refreshToken)) ?: return null
        val now = clock.instant()
        if (grant.clientId != clientId || grant.refreshExpiresAt?.isAfter(now) != true) return null
        return issue(grant, grant, now)
    }

    private fun issue(old: McpGrant, base: McpGrant, now: Instant): Tokens? {
        val access = token()
        val refresh = token()
        val next = base.copy(
            accessHash = hash(access), accessExpiresAt = now.plus(accessTtl),
            refreshHash = hash(refresh), refreshExpiresAt = now.plus(refreshTtl), lastUsedAt = now,
        )
        if (!store.replace(old, next)) return null
        return Tokens(ACCESS_PREFIX + access, refresh, accessTtl.seconds)
    }

    /** The grant an access token opens; null when unknown, expired or revoked. Read on every call: a revocation acts at once. */
    fun authenticate(accessToken: String?): McpGrant? {
        val raw = accessToken?.removePrefix(ACCESS_PREFIX)?.takeIf { it.isNotEmpty() } ?: return null
        val grant = store.find(McpGrantStore.Credential.ACCESS, hash(raw)) ?: return null
        val now = clock.instant()
        if (grant.accessExpiresAt?.isAfter(now) != true) return null
        if (grant.lastUsedAt.plus(TOUCH_EVERY).isBefore(now)) store.touch(grant.id, now)
        return grant
    }

    /** The clients [playerId] approved, still usable. */
    fun grants(playerId: UUID): List<McpGrant> = store.grants(playerId).filter { it.codeHash == null }

    /** False when [grantId] is not one of [playerId]'s. */
    fun revoke(playerId: UUID, grantId: String): Boolean {
        if (store.grants(playerId).none { it.id == grantId }) return false
        store.delete(grantId)
        return true
    }

    /** Lets grant [grantId] of [playerId] deploy, or not; false when it is not theirs. */
    fun allowPublish(playerId: UUID, grantId: String, allow: Boolean): Boolean {
        if (grants(playerId).none { it.id == grantId }) return false
        return store.setPublish(playerId, grantId, allow)
    }

    /** [Sessions.refresh]'s report for one player: like its sessions, a player without view loses its grants. */
    fun permissionsChanged(origin: String, playerId: UUID, permissions: Set<String>) {
        if (EditorPermissions.VIEW in permissions) {
            store.setPermissions(playerId, origin, permissions - EditorPermissions.CONFIG)
        } else {
            store.deletePlayer(playerId, origin)
        }
    }

    private fun validRedirect(uri: String): Boolean {
        val parsed = runCatching { URI(uri) }.getOrNull() ?: return false
        if (parsed.fragment != null || parsed.host.isNullOrEmpty() || parsed.userInfo != null) return false
        return when (parsed.scheme) {
            "https" -> true
            "http" -> parsed.host == "localhost" || parsed.host == "127.0.0.1" || parsed.host == "[::1]"
            else -> false
        }
    }

    private fun token(): String {
        val bytes = ByteArray(32).also(random::nextBytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    companion object {
        /** Says what a bearer token is when one leaks into a log: an Artisan MCP token. */
        const val ACCESS_PREFIX = "amcp_"
        const val MAX_CLIENTS = 1000
        private val UNUSED_CLIENT: Duration = Duration.ofHours(1)
        private val TOUCH_EVERY: Duration = Duration.ofMinutes(5)
        /** RFC 7636: 43 to 128 unreserved characters; a S256 challenge is 43. */
        private val VERIFIER = Regex("[A-Za-z0-9._~-]{43,128}")
        private val CHALLENGE = Regex("[A-Za-z0-9_-]{43}")

        fun hash(value: String): String =
            MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

        fun challenge(verifier: String): String =
            Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
    }
}
