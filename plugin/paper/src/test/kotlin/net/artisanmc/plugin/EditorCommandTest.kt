package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EditorCommandTest {

    private val plain = PlainTextComponentSerializer.plainText()

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest  fun teardown() { MockBukkit.unmock() }

    private fun drainMessages(sender: be.seeseemelk.mockbukkit.command.ConsoleCommandSenderMock): List<String> {
        val out = mutableListOf<String>()
        while (true) {
            val next = sender.nextComponentMessage() ?: break
            out += plain.serialize(next)
        }
        return out
    }

    private fun run(vararg args: String): List<String> {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        plugin.stopEditor()
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        assertTrue(cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf(*args)), "Command should return true")
        return drainMessages(sender)
    }

    @Test
    fun `editor without a running web server points at web enabled`() {
        val messages = run("editor")
        assertTrue(messages.any { it.contains("web.enabled") }, "Expected the web.enabled hint: $messages")
        assertFalse(messages.any { it.contains("artisanmc.net") }, "No cloud address is advertised: $messages")
    }

    @Test
    fun `link, member and trusteditor are not subcommands`() {
        for (sub in listOf("link", "member", "trusteditor")) {
            val messages = run(sub, "X")
            assertTrue(messages.any { it.contains("Usage") }, "Expected fallback usage message for $sub: $messages")
            MockBukkit.unmock()
            MockBukkit.mock()
        }
    }
}
