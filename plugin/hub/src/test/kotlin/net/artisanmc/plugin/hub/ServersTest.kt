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
        override val id = Servers.LOCAL
        override val uuid = "u-local"
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
    fun `servers known to the database are listed offline, with their last presence`() {
        val servers = Servers(local, known = { mapOf("survie" to Servers.Seen("u-survie", seen)) })
        assertEquals(listOf("local", "survie"), servers.all().map { it.id })
        assertFalse(servers.find("survie")!!.online)
        assertEquals(seen, servers.lastSeen("survie"))
        assertNull(servers.lastSeen("other"))
    }

    @Test
    fun `a disconnected server the database no longer knows is dropped`() {
        var known = mapOf("survie" to Servers.Seen("u-survie", seen))
        val servers = Servers(local, known = { known })
        servers.all()
        known = mapOf("survival" to Servers.Seen("u-survival", seen))
        assertEquals(listOf("local", "survival"), servers.all().map { it.id })
    }

    @Test
    fun `without a database, disconnected servers stay listed until the hub restarts`() {
        val servers = Servers(local)
        servers.remote("survie")
        assertEquals(listOf("local", "survie"), servers.all().map { it.id })
    }
}
