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
    fun `a session ends after its lifetime`() {
        val link = assertIs<Sessions.LinkResult.Issued>(sessions.issueLink(player, "Iban", setOf(EditorPermissions.VIEW)))
        val session = assertNotNull(sessions.redeem(link.token))
        assertEquals(session, sessions.find(session.id))
        now = now.plus(Duration.ofHours(12))
        assertNull(sessions.find(session.id))
    }
}
