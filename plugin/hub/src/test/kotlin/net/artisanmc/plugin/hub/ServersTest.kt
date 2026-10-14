package net.artisanmc.plugin.hub

import net.artisanmc.plugin.protocol.ServerLink
import java.time.Instant
import java.util.concurrent.CompletableFuture
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

class ServersTest {
    private val local = object : EditorServer {
        override val id = "u-local"
        override val online = true
        override val link = ServerLink { CompletableFuture.completedFuture(emptyMap()) }
        override val label = "lobby"
        override val minecraftVersion = "1.21.7"
        override val pluginVersion = "2.0.0"
        override fun modules() = emptyList<Map<String, Any?>>()
        override fun dataSources() = emptyList<Map<String, Any?>>()
        override fun models() = emptyList<Map<String, Any?>>()
        override fun screens() = emptyList<Map<String, Any?>>()
        override fun serverConfig() = null
        override fun customItems() = emptyList<Map<String, String>>()
        override fun applyResourcePack(hash: String, path: String) {}
    }
    private val seen = Instant.parse("2026-10-14T10:00:00Z")

    @Test
    fun `servers known to the database are listed offline by id, with their name and last presence`() {
        val servers = Servers(local, known = { mapOf("u-survie" to Servers.Seen("survie", seen)) })
        assertEquals(listOf("u-local", "u-survie"), servers.all().map { it.id })
        assertEquals("survie", servers.find("u-survie")!!.label)
        assertFalse(servers.find("u-survie")!!.online)
        assertEquals(seen, servers.lastSeen("u-survie"))
        assertNull(servers.lastSeen("u-other"))
        assertNull(servers.find("survie"))
    }

    @Test
    fun `the hub's own server comes first, the others by name`() {
        val servers = Servers(local, known = { mapOf("u-2" to Servers.Seen("zeta", seen), "u-1" to Servers.Seen("alpha", seen)) })
        assertEquals(listOf("u-local", "u-1", "u-2"), servers.all().map { it.id })
    }

    @Test
    fun `a renamed server keeps its id`() {
        var known = mapOf("u-survie" to Servers.Seen("survie", seen))
        val servers = Servers(local, known = { known })
        servers.all()
        known = mapOf("u-survie" to Servers.Seen("survival", seen))
        assertEquals(listOf("u-local" to "lobby", "u-survie" to "survival"), servers.all().map { it.id to it.label })
    }

    @Test
    fun `a disconnected server the database no longer knows is dropped`() {
        var known = mapOf("u-survie" to Servers.Seen("survie", seen))
        val servers = Servers(local, known = { known })
        servers.all()
        known = mapOf("u-survival" to Servers.Seen("survival", seen))
        assertEquals(listOf("u-local", "u-survival"), servers.all().map { it.id })
    }

    @Test
    fun `without a database, disconnected servers stay listed until the hub restarts`() {
        val servers = Servers(local)
        servers.remote("u-survie", "survie")
        assertEquals(listOf("u-local", "u-survie"), servers.all().map { it.id })
    }

    @Test
    fun `a project is named by its server id and its folder, on the hub's own server too`() {
        val servers = Servers(local, known = { mapOf("u-survie" to Servers.Seen("survie", seen)) })
        assertEquals("u-local" to "shop", servers.project("u-local.shop")!!.let { it.server.id to it.folder })
        assertEquals("u-survie.shop", servers.project("u-survie.shop")!!.id)
        assertNull(servers.project("shop"))
        assertNull(servers.project("u-local."))
        assertNull(servers.project("u-local.a.b"))
        assertNull(servers.project("u-other.shop"))
        assertEquals("u-survie.shop", ProjectRef.id("u-survie", "shop"))
    }
}
