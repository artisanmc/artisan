package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.config.ServerConfigAccess
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class ServerConfigWebSocketTest {
    private val mapper = ObjectMapper()
    private val written = mutableListOf<Map<String, Any?>>()
    private val access = object : ServerConfigAccess {
        var language = "en"
        override fun report() = mapOf<String, Any?>("language" to language)
        override fun write(changes: Map<String, Any?>): String? {
            if ("server_key" in changes) return "server_key: unknown_key"
            written += changes
            language = changes["language"] as String
            return null
        }
    }

    private fun provider(sent: LinkedBlockingQueue<String>) = SyncedMenuProvider(
        roots = ProjectRoots(Files.createTempDirectory("artisan-projects-").toFile()),
        logger = null,
        serverConfig = access,
    ).also { it.setSendForTesting(sent::add) }

    private fun exchange(raw: String): com.fasterxml.jackson.databind.JsonNode {
        val sent = LinkedBlockingQueue<String>()
        val provider = provider(sent)
        try {
            provider.javaClass.getDeclaredMethod("handleMessage", String::class.java)
                .apply { isAccessible = true }.invoke(provider, raw)
            return mapper.readTree(sent.poll(2, TimeUnit.SECONDS))
        } finally {
            provider.shutdown()
        }
    }

    @Test
    fun `write applies and replies with the new config`() {
        val json = exchange("""{"type":"server_config_write","request_id":"r1","changes":{"language":"fr"}}""")
        assertEquals("server_config_write_result", json["type"].asText())
        assertEquals("r1", json["request_id"].asText())
        assertEquals(true, json["ok"].asBoolean())
        assertEquals("fr", json["server_config"]["language"].asText())
        assertEquals(listOf(mapOf<String, Any?>("language" to "fr")), written)
    }

    @Test
    fun `refused write reports the error`() {
        val json = exchange("""{"type":"server_config_write","request_id":"r2","changes":{"server_key":"x"}}""")
        assertEquals(false, json["ok"].asBoolean())
        assertEquals("invalid_config", json["error"].asText())
        assertEquals("server_key: unknown_key", json["message"].asText())
    }
}
