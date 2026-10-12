package net.artisanmc.plugin.hub

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

/** Un joueur connecté à l'éditeur. Ses permissions sont celles qu'il avait en demandant le lien. */
data class EditorSession(
    val id: String,
    val playerId: UUID,
    val playerName: String,
    val permissions: Set<String>,
    val expiresAt: Instant,
) {
    fun can(permission: String) = permission in permissions
}

/**
 * Liens de connexion donnés par `/artisan editor`, puis sessions ouvertes par ces liens.
 * Un lien sert une fois, vit [linkTtl], et un joueur n'en obtient qu'un par [linkInterval].
 */
class Sessions(
    private val clock: Clock = Clock.systemUTC(),
    private val linkTtl: Duration = Duration.ofSeconds(60),
    private val linkInterval: Duration = Duration.ofMinutes(1),
    private val sessionTtl: Duration = Duration.ofHours(12),
) {
    private class Link(val playerId: UUID, val playerName: String, val permissions: Set<String>, val expiresAt: Instant)

    private val random = SecureRandom()
    private val links = ConcurrentHashMap<String, Link>()
    private val lastLink = ConcurrentHashMap<UUID, Instant>()
    private val sessions = ConcurrentHashMap<String, EditorSession>()

    sealed interface LinkResult {
        data class Issued(val token: String) : LinkResult
        data class TooSoon(val retryAfter: Duration) : LinkResult
    }

    fun issueLink(playerId: UUID, playerName: String, permissions: Set<String>): LinkResult {
        val now = clock.instant()
        purge(now)
        val previous = lastLink[playerId]
        if (previous != null && previous.plus(linkInterval).isAfter(now)) {
            return LinkResult.TooSoon(Duration.between(now, previous.plus(linkInterval)))
        }
        lastLink[playerId] = now
        val token = token()
        links[token] = Link(playerId, playerName, permissions, now.plus(linkTtl))
        return LinkResult.Issued(token)
    }

    /** Échange un lien contre une session. Null : lien inconnu, déjà servi ou expiré. */
    fun redeem(token: String): EditorSession? {
        val link = links.remove(token) ?: return null
        val now = clock.instant()
        if (!link.expiresAt.isAfter(now)) return null
        val session = EditorSession(token(), link.playerId, link.playerName, link.permissions, now.plus(sessionTtl))
        sessions[session.id] = session
        return session
    }

    fun find(id: String?): EditorSession? {
        val session = sessions[id ?: return null] ?: return null
        if (session.expiresAt.isAfter(clock.instant())) return session
        sessions.remove(id)
        return null
    }

    fun close(id: String) {
        sessions.remove(id)
    }

    private fun purge(now: Instant) {
        links.values.removeIf { !it.expiresAt.isAfter(now) }
        sessions.values.removeIf { !it.expiresAt.isAfter(now) }
        lastLink.values.removeIf { !it.plus(linkInterval).isAfter(now) }
    }

    private fun token(): String {
        val bytes = ByteArray(32).also(random::nextBytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }
}
