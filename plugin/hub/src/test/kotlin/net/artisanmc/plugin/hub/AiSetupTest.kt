package net.artisanmc.plugin.hub

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame

/** The servers of one database each run the assistant on the same saved settings (ADR `peer-servers`). */
class AiSetupTest {
    private class MovingClock(var now: Instant = Instant.parse("2026-10-29T10:00:00Z")) : Clock() {
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId) = this
        override fun instant() = now
    }

    private val model = object : AiProvider {
        override val model = "scripted"
        override fun conversation(system: String, tools: List<McpTools.Tool>) = error("not called")
    }
    private val tools = McpTools(McpProjects(Servers(McpFixtures.server(mutableListOf())), null, McpFixtures.Drafts()))
    private val clock = MovingClock()
    private fun hub(store: AiSettingsStore) = AiSetup(AiConfig(), store, tools, null, { model }, Duration.ofSeconds(30), clock)

    @Test
    fun `a save on one server reaches the others when they read the settings again`() {
        val store = MemoryAiSettingsStore()
        val a = hub(store)
        val b = hub(store)
        assertNull(b.assistant())
        a.save(AiConfig("anthropic", "sk-shared-key", "deepseek-chat"))
        assertNotNull(a.assistant())
        assertNull(b.assistant(), "read again only after 30 s")

        clock.now = clock.now.plusSeconds(30)
        val assistant = assertNotNull(b.assistant())
        assertEquals("deepseek-chat", b.current().config.model)

        clock.now = clock.now.plusSeconds(60)
        assertSame(assistant, b.assistant(), "unchanged settings keep the assistant and its conversations")

        a.save(null)
        clock.now = clock.now.plusSeconds(30)
        assertNull(b.assistant())
    }

    @Test
    fun `a database that stops answering keeps the settings read last`() {
        var open = true
        val saved = AiConfig("anthropic", "sk-shared-key", "m")
        val store = object : AiSettingsStore {
            override fun read() = if (open) saved else throw IllegalStateException("down")
            override fun write(config: AiConfig?) = Unit
        }
        val hub = hub(store)
        assertNotNull(hub.assistant())
        open = false
        clock.now = clock.now.plusSeconds(60)
        assertNotNull(hub.assistant())
    }
}
