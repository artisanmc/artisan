package net.artisanmc.plugin.hub

import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object EditorPermissions {
    const val VIEW = "artisan.editor.view"
    const val EDIT = "artisan.editor.edit"
    const val PUBLISH = "artisan.editor.publish"
    const val CONFIG = "artisan.editor.config"
    val ALL = listOf(VIEW, EDIT, PUBLISH, CONFIG)
}

/**
 * A player signed in to the editor. Its permissions are the ones it had when asking for the link,
 * then the ones [origin], the server it asked on (by server id), reads again while the player is on it.
 */
data class EditorSession(
    val id: String,
    val playerId: UUID,
    val playerName: String,
    val permissions: Set<String>,
    val expiresAt: Instant,
    val origin: String = "",
) {
    fun can(permission: String) = permission in permissions
}

/** Where sessions outlive a restart, keyed by a hash of their id: a leaked row opens nothing. */
interface SessionStore {
    fun put(key: String, session: EditorSession)
    fun get(key: String): EditorSession?
    fun touch(key: String, expiresAt: Instant)
    fun delete(key: String)
    fun purge(now: Instant)
    fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>)
    /** Every session of [playerId], or only those [origin] issued; the number deleted. */
    fun deletePlayer(playerId: UUID, origin: String?): Int
}

/**
 * Sign-in links given by `/artisan editor`, then the sessions those links open.
 * A link works once, lives [linkTtl], and a player gets at most one per [linkInterval].
 * A session closes after [sessionTtl] without a request; with a [store], it survives a restart.
 * A link is stored too: the servers of one database share an address (ADR `peer-servers`), and the
 * one that answers it may not be the one that issued the link.
 */
class Sessions(
    private val clock: Clock = Clock.systemUTC(),
    private val linkTtl: Duration = Duration.ofSeconds(60),
    private val linkInterval: Duration = Duration.ofMinutes(1),
    private val sessionTtl: Duration = Duration.ofDays(7),
    private val store: SessionStore? = null,
    /**
     * Where the [store] is written: the links and sessions live in memory first, the rows follow.
     * `/artisan editor` runs on the main thread and must not wait for a connection (10 s timeout).
     * Reads stay on the caller: a session another server opened is looked up when asked.
     */
    private val writer: java.util.concurrent.Executor = java.util.concurrent.Executor { it.run() },
) {
    private class Link(val playerId: UUID, val playerName: String, val permissions: Set<String>, val expiresAt: Instant, val origin: String)

    private val random = SecureRandom()
    private val links = ConcurrentHashMap<String, Link>()
    private val lastLink = ConcurrentHashMap<UUID, Instant>()
    private val sessions = ConcurrentHashMap<String, EditorSession>()
    /** When each session in memory was last read from the store. */
    private val checked = ConcurrentHashMap<String, Instant>()
    /** Ids looked up and found nowhere, with when: a stale cookie is not read from the store on every request. */
    private val missing = ConcurrentHashMap<String, Instant>()
    /** The last permissions each server reported per player: an unchanged report touches nothing. */
    private val reported = ConcurrentHashMap<Pair<String, UUID>, Set<String>>()
    /** Told of each changed report of [refresh]: MCP grants follow the player's permissions too (ADR `mcp-server`). */
    private val listeners = java.util.concurrent.CopyOnWriteArrayList<(origin: String, playerId: UUID, permissions: Set<String>) -> Unit>()

    fun onPermissions(listener: (origin: String, playerId: UUID, permissions: Set<String>) -> Unit) {
        listeners += listener
    }

    sealed interface LinkResult {
        data class Issued(val token: String) : LinkResult
        data class TooSoon(val retryAfter: Duration) : LinkResult
    }

    fun issueLink(playerId: UUID, playerName: String, permissions: Set<String>, origin: String = ""): LinkResult {
        val now = clock.instant()
        purge(now)
        val previous = lastLink[playerId]
        if (previous != null && previous.plus(linkInterval).isAfter(now)) {
            return LinkResult.TooSoon(Duration.between(now, previous.plus(linkInterval)))
        }
        lastLink[playerId] = now
        val token = token()
        links[token] = Link(playerId, playerName, permissions, now.plus(linkTtl), origin)
        store?.let { s -> writer.execute { s.put(key(LINK + token), EditorSession(LINK, playerId, playerName, permissions, now.plus(linkTtl), origin)) } }
        reported.remove(origin to playerId)
        return LinkResult.Issued(token)
    }

    /**
     * A link for [session]'s player on another address of the editor (its name just changed): the
     * cookie stays on the old one. Not throttled like [issueLink]: the player is already signed in.
     */
    fun handOff(session: EditorSession): String {
        val token = token()
        val link = Link(session.playerId, session.playerName, session.permissions, clock.instant().plus(linkTtl), session.origin)
        links[token] = link
        store?.let { s -> writer.execute { s.put(key(LINK + token), EditorSession(LINK, link.playerId, link.playerName, link.permissions, link.expiresAt, link.origin)) } }
        return token
    }

    /** Trades a link for a session. Null: unknown, already used or expired link. */
    fun redeem(token: String): EditorSession? {
        val link = links.remove(token)
            ?: store?.get(key(LINK + token))?.let { Link(it.playerId, it.playerName, it.permissions, it.expiresAt, it.origin) }
            ?: return null
        store?.let { s -> writer.execute { s.delete(key(LINK + token)) } }
        val now = clock.instant()
        if (!link.expiresAt.isAfter(now)) return null
        val session = EditorSession(token(), link.playerId, link.playerName, link.permissions, now.plus(sessionTtl), link.origin)
        missing.remove(session.id)
        sessions[session.id] = session
        store?.let { s -> writer.execute { s.put(key(session.id), session) } }
        return session
    }

    /** The open session [id] names; each request pushes its end back, written at most once per [TOUCH_EVERY]. */
    fun find(id: String?): EditorSession? {
        if (id.isNullOrEmpty() || id.startsWith(LINK)) return null
        val session = cached(id)
            ?: unknown(id)?.let { return null }
            ?: store?.get(key(id))?.copy(id = id)?.also { checked[id] = clock.instant() }
            // Opened while the database was not: in memory alone, never seen stored.
            ?: sessions[id]?.takeIf { checked[id] == null }
            ?: run {
                remember(id)
                close(id)
                return null
            }
        val now = clock.instant()
        if (!session.expiresAt.isAfter(now)) {
            close(id)
            return null
        }
        val extended = now.plus(sessionTtl)
        if (session.expiresAt.plus(TOUCH_EVERY).isAfter(extended)) return session.also { sessions[id] = it }
        store?.let { s -> writer.execute { s.touch(key(id), extended) } }
        return session.copy(expiresAt = extended).also { sessions[id] = it }
    }

    /**
     * The session in memory, read again from the [store] every [RECHECK]: another server of the
     * database may have changed its permissions or closed it (ADR `peer-servers`).
     */
    private fun cached(id: String): EditorSession? {
        val session = sessions[id] ?: return null
        if (store == null) return session
        val last = checked[id]
        return if (last != null && last.plus(RECHECK).isAfter(clock.instant())) session else null
    }

    /** True while [id] was found nowhere less than [MISSING_FOR] ago: the store is not asked again. */
    private fun unknown(id: String): Boolean? {
        val since = missing[id] ?: return null
        if (since.plus(MISSING_FOR).isAfter(clock.instant())) return true
        missing.remove(id)
        return null
    }

    /** A page load with a stale cookie is dozens of requests: the first asks the store, the others do not. */
    private fun remember(id: String) {
        if (missing.size >= MISSING_MAX) missing.clear()
        missing[id] = clock.instant()
    }

    fun close(id: String) {
        checked.remove(id)
        sessions.remove(id)
        store?.let { s -> writer.execute { s.delete(key(id)) } }
    }

    /** Signs [playerId] out everywhere; the number of sessions closed. */
    fun closeAll(playerId: UUID): Int {
        val inMemory = sessions.values.count { it.playerId == playerId }
        sessions.values.removeIf { it.playerId == playerId }
        // A session opened before the database was is only in memory; one from before a restart, only stored.
        // Deleted on the writer, after the rows queued before it: a session just opened is not written back after.
        val stored = store?.let { s ->
            val deleted = java.util.concurrent.CompletableFuture<Int>()
            writer.execute { deleted.complete(runCatching { s.deletePlayer(playerId, null) }.getOrDefault(0)) }
            runCatching { deleted.get(15, java.util.concurrent.TimeUnit.SECONDS) }.getOrDefault(0)
        } ?: 0
        return maxOf(inMemory, stored)
    }

    /**
     * The editor permissions [origin] reads for its online players: they replace those of the
     * sessions it issued, and a player without [EditorPermissions.VIEW] is signed out of them.
     */
    fun refresh(origin: String, players: Map<UUID, Set<String>>) {
        for ((playerId, permissions) in players) {
            if (reported.put(origin to playerId, permissions) == permissions) continue
            listeners.forEach { listener -> writer.execute { runCatching { listener(origin, playerId, permissions) } } }
            val mine = { s: EditorSession -> s.playerId == playerId && s.origin == origin }
            if (EditorPermissions.VIEW in permissions) {
                sessions.replaceAll { _, s -> if (mine(s)) s.copy(permissions = permissions) else s }
                store?.let { s -> writer.execute { s.setPermissions(playerId, origin, permissions) } }
            } else {
                sessions.values.removeIf(mine)
                store?.let { s -> writer.execute { s.deletePlayer(playerId, origin) } }
            }
        }
    }

    private fun purge(now: Instant) {
        links.values.removeIf { !it.expiresAt.isAfter(now) }
        sessions.values.removeIf { !it.expiresAt.isAfter(now) }
        checked.keys.retainAll(sessions.keys)
        lastLink.values.removeIf { !it.plus(linkInterval).isAfter(now) }
        store?.let { s -> writer.execute { s.purge(now) } }
    }

    private fun key(id: String): String =
        MessageDigest.getInstance("SHA-256").digest(id.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun token(): String {
        val bytes = ByteArray(32).also(random::nextBytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    companion object {
        private val TOUCH_EVERY: Duration = Duration.ofHours(1)
        /** Prefix of a stored link's key: never a session id, which is plain base64url. */
        const val LINK = "link:"
        val RECHECK: Duration = Duration.ofSeconds(30)
        /**
         * How long an id found nowhere stays unknown without a store read. Short: a session opened on
         * another server of the database reaches the store on its writer thread, a moment after its link.
         */
        val MISSING_FOR: Duration = Duration.ofSeconds(5)
        const val MISSING_MAX = 4096
    }
}
