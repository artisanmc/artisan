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
 */
class Sessions(
    private val clock: Clock = Clock.systemUTC(),
    private val linkTtl: Duration = Duration.ofSeconds(60),
    private val linkInterval: Duration = Duration.ofMinutes(1),
    private val sessionTtl: Duration = Duration.ofDays(7),
    private val store: SessionStore? = null,
) {
    private class Link(val playerId: UUID, val playerName: String, val permissions: Set<String>, val expiresAt: Instant, val origin: String)

    private val random = SecureRandom()
    private val links = ConcurrentHashMap<String, Link>()
    private val lastLink = ConcurrentHashMap<UUID, Instant>()
    private val sessions = ConcurrentHashMap<String, EditorSession>()
    /** The last permissions each server reported per player: an unchanged report touches nothing. */
    private val reported = ConcurrentHashMap<Pair<String, UUID>, Set<String>>()

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
        reported.remove(origin to playerId)
        return LinkResult.Issued(token)
    }

    /** Trades a link for a session. Null: unknown, already used or expired link. */
    fun redeem(token: String): EditorSession? {
        val link = links.remove(token) ?: return null
        val now = clock.instant()
        if (!link.expiresAt.isAfter(now)) return null
        val session = EditorSession(token(), link.playerId, link.playerName, link.permissions, now.plus(sessionTtl), link.origin)
        sessions[session.id] = session
        store?.put(key(session.id), session)
        return session
    }

    /** The open session [id] names; each request pushes its end back, written at most once per [TOUCH_EVERY]. */
    fun find(id: String?): EditorSession? {
        if (id.isNullOrEmpty()) return null
        val session = sessions[id] ?: store?.get(key(id))?.copy(id = id) ?: return null
        val now = clock.instant()
        if (!session.expiresAt.isAfter(now)) {
            close(id)
            return null
        }
        val extended = now.plus(sessionTtl)
        if (session.expiresAt.plus(TOUCH_EVERY).isAfter(extended)) return session.also { sessions[id] = it }
        store?.touch(key(id), extended)
        return session.copy(expiresAt = extended).also { sessions[id] = it }
    }

    fun close(id: String) {
        sessions.remove(id)
        store?.delete(key(id))
    }

    /** Signs [playerId] out everywhere; the number of sessions closed. */
    fun closeAll(playerId: UUID): Int {
        val inMemory = sessions.values.count { it.playerId == playerId }
        sessions.values.removeIf { it.playerId == playerId }
        return store?.deletePlayer(playerId, null) ?: inMemory
    }

    /**
     * The editor permissions [origin] reads for its online players: they replace those of the
     * sessions it issued, and a player without [EditorPermissions.VIEW] is signed out of them.
     */
    fun refresh(origin: String, players: Map<UUID, Set<String>>) {
        for ((playerId, permissions) in players) {
            if (reported.put(origin to playerId, permissions) == permissions) continue
            val mine = { s: EditorSession -> s.playerId == playerId && s.origin == origin }
            if (EditorPermissions.VIEW in permissions) {
                sessions.replaceAll { _, s -> if (mine(s)) s.copy(permissions = permissions) else s }
                store?.setPermissions(playerId, origin, permissions)
            } else {
                sessions.values.removeIf(mine)
                store?.deletePlayer(playerId, origin)
            }
        }
    }

    private fun purge(now: Instant) {
        links.values.removeIf { !it.expiresAt.isAfter(now) }
        sessions.values.removeIf { !it.expiresAt.isAfter(now) }
        lastLink.values.removeIf { !it.plus(linkInterval).isAfter(now) }
        store?.purge(now)
    }

    private fun key(id: String): String =
        MessageDigest.getInstance("SHA-256").digest(id.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun token(): String {
        val bytes = ByteArray(32).also(random::nextBytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private companion object {
        val TOUCH_EVERY: Duration = Duration.ofHours(1)
    }
}
