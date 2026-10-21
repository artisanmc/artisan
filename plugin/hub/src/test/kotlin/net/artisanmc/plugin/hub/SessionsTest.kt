package net.artisanmc.plugin.hub

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SessionsTest {
    private var now = Instant.parse("2026-10-12T12:00:00Z")
    private val clock = object : Clock() {
        override fun instant() = now
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?) = this
    }
    private val sessions = Sessions(clock)
    private val player = UUID.randomUUID()

    @Test
    fun `one link per player per minute`() {
        assertIs<Sessions.LinkResult.Issued>(sessions.issueLink(player, "Iban", emptySet()))
        val refused = assertIs<Sessions.LinkResult.TooSoon>(sessions.issueLink(player, "Iban", emptySet()))
        assertEquals(Duration.ofMinutes(1), refused.retryAfter)
        now = now.plusSeconds(61)
        assertIs<Sessions.LinkResult.Issued>(sessions.issueLink(player, "Iban", emptySet()))
    }

    @Test
    fun `an expired link opens nothing`() {
        val link = assertIs<Sessions.LinkResult.Issued>(sessions.issueLink(player, "Iban", emptySet()))
        now = now.plusSeconds(60)
        assertNull(sessions.redeem(link.token))
    }

    @Test
    fun `a session ends after its idle lifetime`() {
        val session = signIn(sessions)
        assertEquals(session, sessions.find(session.id))
        now = now.plus(Duration.ofDays(7))
        assertNull(sessions.find(session.id))
    }

    @Test
    fun `activity keeps a session open`() {
        val session = signIn(sessions)
        repeat(3) {
            now = now.plus(Duration.ofDays(5))
            assertNotNull(sessions.find(session.id))
        }
    }

    @Test
    fun `the store is written by the writer, after the link is issued`() {
        val store = MemoryStore()
        val queued = mutableListOf<Runnable>()
        val sessions = Sessions(clock, store = store, writer = { queued += it })
        val link = assertIs<Sessions.LinkResult.Issued>(sessions.issueLink(player, "Iban", setOf(EditorPermissions.VIEW)))
        assertEquals(0, store.rows.size, "nothing waited for the store")
        val session = assertNotNull(sessions.redeem(link.token), "the link opens here before its row exists")
        queued.forEach(Runnable::run)
        assertEquals(1, store.rows.size, "the session's row, the link's deleted")
        assertNotNull(Sessions(clock, store = store).find(session.id))
    }

    @Test
    fun `a session survives a restart`() {
        val store = MemoryStore()
        val session = signIn(Sessions(clock, store = store))
        now = now.plus(Duration.ofDays(2))
        val restarted = Sessions(clock, store = store)
        assertEquals(setOf(EditorPermissions.VIEW), assertNotNull(restarted.find(session.id)).permissions)
        now = now.plus(Duration.ofDays(6))
        assertNotNull(Sessions(clock, store = store).find(session.id))
    }

    @Test
    fun `a closed session is gone after a restart`() {
        val store = MemoryStore()
        val first = Sessions(clock, store = store)
        val session = signIn(first)
        first.close(session.id)
        assertNull(Sessions(clock, store = store).find(session.id))
    }

    @Test
    fun `the store never keeps the session id itself`() {
        val store = MemoryStore()
        val session = signIn(Sessions(clock, store = store))
        assertNull(store.rows[session.id])
    }

    @Test
    fun `permissions read again on the issuing server apply to open sessions, restarts included`() {
        val store = MemoryStore()
        val session = signIn(Sessions(clock, store = store), origin = "survie")
        val restarted = Sessions(clock, store = store)
        restarted.refresh("survie", mapOf(player to setOf(EditorPermissions.VIEW, EditorPermissions.EDIT)))
        assertEquals(setOf(EditorPermissions.VIEW, EditorPermissions.EDIT), restarted.find(session.id)?.permissions)
        assertEquals(setOf(EditorPermissions.VIEW, EditorPermissions.EDIT), Sessions(clock, store = store).find(session.id)?.permissions)
    }

    @Test
    fun `losing the view permission on the issuing server closes the session`() {
        val store = MemoryStore()
        val sessions = Sessions(clock, store = store)
        val session = signIn(sessions, origin = "survie")
        sessions.find(session.id)
        sessions.refresh("survie", mapOf(player to emptySet()))
        assertNull(sessions.find(session.id))
        assertNull(Sessions(clock, store = store).find(session.id))
    }

    @Test
    fun `another server's permissions change nothing`() {
        val session = signIn(sessions, origin = "survie")
        sessions.refresh("lobby", mapOf(player to emptySet()))
        assertEquals(setOf(EditorPermissions.VIEW), sessions.find(session.id)?.permissions)
    }

    @Test
    fun `signing a player out closes every session they have`() {
        val store = MemoryStore()
        val sessions = Sessions(clock, store = store)
        val first = signIn(sessions, origin = "survie")
        now = now.plusSeconds(61)
        val second = signIn(sessions, origin = "lobby")
        assertEquals(2, sessions.closeAll(player))
        assertNull(sessions.find(first.id))
        assertNull(Sessions(clock, store = store).find(second.id))
    }

    @Test
    fun `a session opened before the database is counted when closed`() {
        val store = MemoryStore()
        val sessions = Sessions(clock, store = store)
        signIn(sessions)
        store.rows.clear()
        assertEquals(1, sessions.closeAll(player))
    }

    @Test
    fun `a link issued on one server of the database opens a session on another`() {
        val store = MemoryStore()
        val link = assertIs<Sessions.LinkResult.Issued>(Sessions(clock, store = store).issueLink(player, "Iban", setOf(EditorPermissions.VIEW), "survie"))
        val other = Sessions(clock, store = store)
        val session = assertNotNull(other.redeem(link.token))
        assertEquals("survie", session.origin)
        assertNull(Sessions(clock, store = store).redeem(link.token), "a link works once, on any server")
        assertNull(other.find(Sessions.LINK + link.token), "a stored link is never a session")
    }

    @Test
    fun `a session closed on another server of the database ends here too`() {
        val store = MemoryStore()
        val here = Sessions(clock, store = store)
        val session = signIn(here, origin = "survie")
        assertNotNull(here.find(session.id))
        Sessions(clock, store = store).refresh("survie", mapOf(player to emptySet()))
        now = now.plus(Sessions.RECHECK).plusSeconds(1)
        assertNull(here.find(session.id))
    }

    @Test
    fun `a cookie found nowhere is read from the store once per window, then again`() {
        val store = MemoryStore()
        val here = Sessions(clock, store = store)
        repeat(20) { assertNull(here.find("stale-cookie")) }
        assertEquals(1, store.gets)
        now = now.plus(Sessions.MISSING_FOR).plusSeconds(1)
        assertNull(here.find("stale-cookie"))
        assertEquals(2, store.gets)
        // Opened on another server of the database, its row landing after this server's first look: found once the window is past.
        val queued = mutableListOf<Runnable>()
        val other = Sessions(clock, store = store, writer = java.util.concurrent.Executor { queued += it })
        val session = signIn(other)
        assertNull(here.find(session.id))
        queued.forEach { it.run() }
        assertNull(here.find(session.id), "unknown for the rest of the window")
        now = now.plus(Sessions.MISSING_FOR).plusSeconds(1)
        assertNotNull(here.find(session.id))
    }

    private fun signIn(sessions: Sessions, origin: String = ""): EditorSession {
        val link = assertIs<Sessions.LinkResult.Issued>(sessions.issueLink(player, "Iban", setOf(EditorPermissions.VIEW), origin))
        return assertNotNull(sessions.redeem(link.token))
    }

    private class MemoryStore : SessionStore {
        val rows = HashMap<String, EditorSession>()
        var gets = 0
        override fun put(key: String, session: EditorSession) { rows[key] = session }
        override fun get(key: String) = rows[key].also { gets++ }
        override fun touch(key: String, expiresAt: Instant) { rows[key] = rows[key]!!.copy(expiresAt = expiresAt) }
        override fun delete(key: String) { rows.remove(key) }
        override fun purge(now: Instant) { rows.values.removeIf { !it.expiresAt.isAfter(now) } }
        override fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) {
            rows.replaceAll { _, s -> if (s.playerId == playerId && s.origin == origin) s.copy(permissions = permissions) else s }
        }
        override fun deletePlayer(playerId: UUID, origin: String?): Int {
            val before = rows.size
            rows.values.removeIf { it.playerId == playerId && (origin == null || it.origin == origin) }
            return before - rows.size
        }
    }
}
