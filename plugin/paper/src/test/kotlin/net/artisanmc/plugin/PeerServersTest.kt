package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.hub.EditorApi
import net.artisanmc.plugin.hub.EditorAssets
import net.artisanmc.plugin.hub.EditorChannel
import net.artisanmc.plugin.hub.EditorServer
import net.artisanmc.plugin.hub.HubServer
import net.artisanmc.plugin.hub.PluginChannel
import net.artisanmc.plugin.hub.RemoteServer
import net.artisanmc.plugin.hub.Servers
import net.artisanmc.plugin.hub.Sessions
import net.artisanmc.plugin.hub.WebConfig
import net.artisanmc.plugin.protocol.ServerAnnouncement
import net.artisanmc.plugin.protocol.ServerLink
import net.artisanmc.plugin.ws.HubLink
import net.artisanmc.plugin.ws.WsClient
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * ADR `peer-servers`: two servers on one database, no `web.hub`. Each serves its own editor and
 * joins the other as a leaf with the database's secret; each lists the other and reaches it.
 */
class PeerServersTest {
    private val mapper = ObjectMapper()
    private val sharedSecret = "from-the-database"

    private inner class Peer(val id: String, val name: String) {
        val local = object : EditorServer {
            override val id = this@Peer.id
            override val online = true
            override val link = ServerLink { CompletableFuture.completedFuture(mapOf("ok" to true)) }
            override val label = name
            override val minecraftVersion = "1.21.7"
            override val pluginVersion = "2.0.0"
            override fun announcement() = ServerAnnouncement.EMPTY
            override fun serverConfig() = null
            override fun customItems() = emptyList<Map<String, String>>()
            override fun applyResourcePack(hash: String, path: String) {}
        }
        val servers = Servers(local, newRemote = { id, name -> RemoteServer(id, name, publicUrl = { "" }) })
        private val sessions = Sessions()
        private val editors = EditorChannel(null)
        // Its own secret is not the database's: the peers get in with the database's alone.
        val hub = HubServer(
            WebConfig(port = 0, bind = "127.0.0.1"), EditorApi.router(servers, sessions, null), sessions,
            EditorAssets(javaClass.classLoader), editors, Logger.getAnonymousLogger(),
            PluginChannel(servers, "own-$name", sessions, editors, { "" }, null, { "db-1" }, { true }, { sharedSecret }),
        )
        var client: WsClient? = null

        /** Joins [other] as a leaf: an internal address that answers nothing first, then its own. */
        fun join(other: Peer) {
            lateinit var c: WsClient
            val link = HubLink(
                url = "ws://127.0.0.1:1/ws/plugin", secret = sharedSecret, serverName = name, databaseId = { "db-1" },
                serverUuid = id, alternates = listOf("ws://127.0.0.1:${other.hub.port}/ws/plugin"), peer = true,
            )
            c = WsClient(link, "1.21.7", onMessage = { raw ->
                val message = mapper.readTree(raw)
                if (message.path("type").asText() == "ping") {
                    c.send(mapOf("type" to "ping_result", "request_id" to message.path("request_id").asText(), "from" to name))
                }
            })
            client = c.also(WsClient::connect)
        }
    }

    private val lobby = Peer("u-lobby", "lobby")
    private val survie = Peer("u-survie", "survie")

    @AfterTest
    fun stop() {
        listOf(lobby, survie).forEach { it.client?.disconnect(); it.hub.stop() }
    }

    private fun waitFor(what: String, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + 15_000
        while (!condition()) {
            assertTrue(System.currentTimeMillis() < end, what)
            Thread.sleep(50)
        }
    }

    @Test
    fun `two servers on one database each list the other and reach it`() {
        assertTrue(lobby.hub.start())
        assertTrue(survie.hub.start())
        lobby.join(survie)
        survie.join(lobby)

        waitFor("lobby lists survie online") { lobby.servers.find("u-survie")?.online == true }
        waitFor("survie lists lobby online") { survie.servers.find("u-lobby")?.online == true }
        assertTrue(lobby.client!!.url.endsWith(":${survie.hub.port}/ws/plugin"), "fell back to the address that answers")

        val fromSurvie = lobby.servers.find("u-survie")!!.link.request(mapOf("type" to "ping")).get(5, TimeUnit.SECONDS)
        assertEquals("survie", fromSurvie["from"])
        val fromLobby = survie.servers.find("u-lobby")!!.link.request(mapOf("type" to "ping")).get(5, TimeUnit.SECONDS)
        assertEquals("lobby", fromLobby["from"])
    }
}
