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

    private fun signIn(sessions: Sessions): EditorSession {
        val link = assertIs<Sessions.LinkResult.Issued>(sessions.issueLink(player, "Iban", setOf(EditorPermissions.VIEW)))
        return assertNotNull(sessions.redeem(link.token))
    }

    private class MemoryStore : SessionStore {
        val rows = HashMap<String, EditorSession>()
        override fun put(key: String, session: EditorSession) { rows[key] = session }
        override fun get(key: String) = rows[key]
        override fun touch(key: String, expiresAt: Instant) { rows[key] = rows[key]!!.copy(expiresAt = expiresAt) }
        override fun delete(key: String) { rows.remove(key) }
        override fun purge(now: Instant) { rows.values.removeIf { !it.expiresAt.isAfter(now) } }
    }
}
