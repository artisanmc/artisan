package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class SiteAccountTest {
    private var now = Instant.parse("2026-11-18T08:00:00Z")
    private val clock = object : Clock() {
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?) = this
        override fun instant() = now
    }

    private class Site : SiteApi {
        var collected: SiteApi.Collected = SiteApi.Collected.Waiting
        var collects = 0
        var valid = setOf("arts_token")
        val asked = mutableListOf<Triple<String, String, Map<String, String>>>()

        override fun startLink(name: String) = SiteApi.Started("device", "ABCD-EFGH", "https://site.test/link/?code=ABCD-EFGH", 600, 5)

        override fun collect(deviceCode: String): SiteApi.Collected {
            collects++
            return collected
        }

        override fun updates(token: String, channel: String, installed: Map<String, String>): JsonNode {
            if (token !in valid) throw SiteFailure("site_unlinked")
            asked += Triple(token, channel, installed)
            return Call.mapper.readTree("""{"channel":"$channel","modules":[]}""")
        }
    }

    private val site = Site()
    private val store = MemorySiteLinkStore()
    private val account = SiteAccount("https://site.test", store, site, clock, Duration.ofSeconds(30))

    @Test
    fun `a code is shown until the owner approves, then the token is kept`() {
        val pending = account.start("survie")
        assertEquals("ABCD-EFGH", pending.userCode)
        assertNull(account.link())

        // Not before the interval the site asked for.
        account.poll()
        assertEquals(0, site.collects)
        now = now.plusSeconds(5)
        account.poll()
        assertEquals(1, site.collects)
        assertNotNull(account.pending())

        site.collected = SiteApi.Collected.Linked("arts_token")
        now = now.plusSeconds(5)
        account.poll()
        assertNull(account.pending())
        assertEquals("arts_token", account.link()?.token)
        assertEquals(SiteLink("arts_token", "survie", now), store.read())
    }

    @Test
    fun `an expired or refused code ends the request`() {
        account.start("survie")
        site.collected = SiteApi.Collected.Gone
        now = now.plusSeconds(5)
        account.poll()
        assertNull(account.pending())

        account.start("survie")
        now = now.plusSeconds(601)
        assertNull(account.pending())
        account.poll()
        assertEquals(1, site.collects)
    }

    @Test
    fun `a link made on another server of the database is read within the refresh`() {
        assertNull(account.link())
        store.write(SiteLink("arts_token", "lobby", now))
        assertNull(account.link())
        now = now.plusSeconds(30)
        assertEquals("lobby", account.link()?.name)
    }

    @Test
    fun `a token the site refuses is forgotten`() {
        store.write(SiteLink("arts_revoked", "survie", now))
        val failure = assertFailsWith<SiteFailure> { account.updates("release", emptyMap()) }
        assertEquals("site_not_linked", failure.code)
        assertNull(store.read())
        assertNull(account.link())
    }

    @Test
    fun `updates are asked with the token and without a link they are refused`() {
        assertEquals("site_not_linked", assertFailsWith<SiteFailure> { account.updates("release", emptyMap()) }.code)
        store.write(SiteLink("arts_token", "survie", now))
        now = now.plusSeconds(30)
        account.updates("dev", mapOf("quests" to "1.2.0"))
        assertEquals(Triple("arts_token", "dev", mapOf("quests" to "1.2.0")), site.asked.single())
    }

    @Test
    fun `unlinking drops the link and the request in progress`() {
        store.write(SiteLink("arts_token", "survie", now))
        account.start("survie")
        account.unlink()
        assertNull(store.read())
        assertNull(account.pending())
    }

    @Test
    fun `the catalogue is set against what the server runs`() {
        val catalogue = Call.mapper.readTree(
            """
            {"modules":[
              {"id":"artisan","name":"Artisan","plugin":"Artisan","tagline":{"en":"The editor"},"price":null,"requires":[],"page":"https://site.test/modules/artisan/versions/",
               "installed":"1.0.0","access":"ok","update":true,
               "latest":{"version":"1.0.1","changelog":"Fixes","sha256":"aa","size":12,"published":"2026-11-18T07:00:00.000Z","download":"https://site.test/downloads/artisan/1.0.1/"}},
              {"id":"quests","name":"Quests","plugin":"ArtisanQuests","tagline":{"en":"Quests"},"price":{"amount":1000,"currency":"eur"},"requires":["artisan"],"page":"",
               "installed":null,"access":"licence","update":false,"latest":null},
              {"id":"store","name":"Store","plugin":"ArtisanStore","tagline":{"en":"Shop"},"price":null,"requires":["artisan"],"page":"",
               "installed":null,"access":"ok","update":false,
               "latest":{"version":"2.0.0","changelog":"","sha256":"bb","size":5,"published":"","download":"https://site.test/downloads/store/2.0.0/"}}
            ]}
            """.trimIndent(),
        )
        val ids = ModuleUpdates.ids(catalogue)
        assertEquals(mapOf("Artisan" to "artisan", "ArtisanQuests" to "quests", "ArtisanStore" to "store"), ids)

        val plugins = mapOf("Artisan" to "1.0.0", "ArtisanStore" to "local-build", "Vault" to "1.7")
        // A version the site cannot compare is not sent; a plugin it does not sell neither.
        assertEquals(mapOf("artisan" to "1.0.0"), ModuleUpdates.installed(ids, plugins))

        val staged = mapOf("Artisan" to mapOf("version" to "1.0.1", "state" to "ready"))
        val rows = ModuleUpdates.rows(catalogue, plugins, staged).associateBy { it["id"] }
        assertEquals(true, rows.getValue("artisan")["update"])
        assertEquals(staged["Artisan"], rows.getValue("artisan")["staged"])
        // Neither where the jar is nor its hash goes to a browser.
        assertEquals(setOf("version", "changelog", "size", "published"), (rows.getValue("artisan")["latest"] as Map<*, *>).keys)
        assertEquals("licence", rows.getValue("quests")["access"])
        assertNull(rows.getValue("quests")["installed"])
        assertEquals(false, rows.getValue("quests")["update"])
        // A local build is offered the published version.
        assertEquals("local-build", rows.getValue("store")["installed"])
        assertEquals(true, rows.getValue("store")["update"])
    }

    @Test
    fun `only the two channels are accepted`() {
        assertEquals("release", SiteRoutes.channel(null))
        assertEquals("dev", SiteRoutes.channel("dev"))
        assertNull(SiteRoutes.channel("nightly"))
    }
}

class SiteAccountDatabaseTest {
    private var now = Instant.parse("2026-11-18T08:00:00Z")
    private val clock = object : Clock() {
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?) = this
        override fun instant() = now
    }
    private var open = true
    private val kept = MemorySiteLinkStore()
    private val store = object : SiteLinkStore {
        override fun read() = if (open) kept.read() else throw IllegalStateException("suite database not open")
        override fun write(link: SiteLink?) = if (open) kept.write(link) else throw IllegalStateException("suite database not open")
    }
    private val site = object : SiteApi {
        override fun startLink(name: String) = SiteApi.Started("device", "ABCD-EFGH", "https://site.test/link/", 600, 5)
        override fun collect(deviceCode: String) = SiteApi.Collected.Linked("arts_token")
        override fun updates(token: String, channel: String, installed: Map<String, String>): JsonNode = Call.mapper.createObjectNode()
    }
    private val account = SiteAccount("https://site.test", store, site, clock, Duration.ofSeconds(30))

    @Test
    fun `no code is asked for while the database is closed`() {
        open = false
        assertFailsWith<IllegalStateException> { account.start("survie") }
        assertNull(account.pending())
    }

    @Test
    fun `a token collected while the database fails is kept and written once it answers`() {
        account.start("survie")
        open = false
        now = now.plusSeconds(5)
        account.poll()
        assertEquals("arts_token", account.link()?.token)
        assertNull(kept.read())
        open = true
        assertEquals("arts_token", account.link()?.token)
        assertEquals("arts_token", kept.read()?.token)
    }
}
