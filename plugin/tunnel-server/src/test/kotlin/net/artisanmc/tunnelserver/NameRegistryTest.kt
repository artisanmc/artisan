package net.artisanmc.tunnelserver

import java.io.File
import java.nio.file.Files
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class NameRegistryTest {
    private val dir: File = Files.createTempDirectory("names").toFile()
    private var now = Instant.parse("2026-10-21T12:00:00Z")
    private val clock = object : Clock() {
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?) = this
        override fun instant() = now
    }

    @AfterTest
    fun clean() {
        dir.deleteRecursively()
    }

    private fun registry() = NameRegistry(File(dir, "names.json"), expiry = Duration.ofDays(90), changesPerDay = 2, claimsPerAddressPerDay = 3, clock = clock)

    @Test
    fun `one name per id, the previous one goes back`() {
        val names = registry()
        assertEquals(NameRegistry.Claim.Taken("survie", null), names.claim("id-a", "survie"))
        assertEquals(NameRegistry.Claim.Taken("survie2", "survie"), names.claim("id-a", "survie2"))
        assertNull(names.idOf("survie"))
        assertEquals("survie2", names.nameOf("id-a"))
        assertEquals("id-a", registry().idOf("survie2"), "kept in the file")
    }

    @Test
    fun `changing names is limited per id and per address, per day`() {
        val names = registry()
        names.claim("id-a", "one")
        names.claim("id-a", "two")
        assertEquals(NameRegistry.Claim.Refused("too_many"), names.claim("id-a", "three"))
        assertIs<NameRegistry.Claim.Taken>(names.claim("id-a", "two"), "keeping its name is no change")
        now = now.plus(Duration.ofDays(1))
        assertIs<NameRegistry.Claim.Taken>(names.claim("id-a", "three"))

        names.claim("id-b", "bbb1", "1.2.3.4")
        names.claim("id-c", "ccc1", "1.2.3.4")
        names.claim("id-d", "ddd1", "1.2.3.4")
        assertEquals(NameRegistry.Claim.Refused("too_many"), names.claim("id-e", "eee1", "1.2.3.4"))
    }

    @Test
    fun `a name nobody connected under expires, a connected one never does`() {
        val names = registry()
        names.claim("id-a", "gone")
        names.claim("id-b", "online")
        now = now.plus(Duration.ofDays(91))
        names.seen("id-c", connected = setOf("id-b", "id-c"))
        assertNull(names.idOf("gone"))
        assertEquals("id-b", names.idOf("online"))
    }

    @Test
    fun `a banned name can no longer be taken`() {
        val names = registry()
        names.claim("id-a", "phish")
        assertEquals("id-a", names.revoke("phish", ban = true))
        assertEquals(NameRegistry.Claim.Refused("reserved"), names.claim("id-b", "phish"))
        assertEquals(NameRegistry.Claim.Refused("reserved"), registry().claim("id-b", "phish"), "the ban is kept")
    }
}
