package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.command.ArtisanCommand
import net.artisanmc.plugin.hub.EditorPermissions
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
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
    fun `update without a plugin naming its releases says where to name them`() {
        val messages = run("update")
        assertTrue(messages.any { it.contains("artisan-releases") }, "Expected the artisan-releases hint: $messages")
    }

    @Test
    fun `the console gets a link signed in as Console`() {
        val server = MockBukkit.getMock()!!
        // Any free port: 8765 may be taken by a local server.
        val version = org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(
            javaClass.classLoader.getResource("plugin.yml")!!.openStream().reader(),
        ).getString("version")
        java.io.File(server.pluginManager.parentTemporaryDirectory, "Artisan-$version").apply { mkdirs() }
            .resolve("environment.yml").writeText("web: { port: 0 }")
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val sender = server.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        try {
            assertTrue(plugin.editor != null, "The editor web server runs")
            cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("editor"))
            val messages = drainMessages(sender)
            val url = Regex("""https?://\S+/login/(\S+)""").find(messages.joinToString(" "))
            assertTrue(url != null, "Expected a printed link: $messages")
            val session = plugin.editorSessions.redeem(url!!.groupValues[1])!!
            assertEquals(ArtisanCommand.CONSOLE_ID, session.playerId)
            assertEquals("Console", session.playerName)
            assertEquals(EditorPermissions.ALL.toSet(), session.permissions)

            cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("editor", "logout"))
            // The stored sessions are closed off the main thread, the answer comes back on it
            // (other async tasks, such as the tunnel link, never finish: no waiting on them all).
            val deadline = System.currentTimeMillis() + 10_000
            var closed = drainMessages(sender)
            while (closed.isEmpty() && System.currentTimeMillis() < deadline) {
                Thread.sleep(20)
                server.scheduler.performOneTick()
                closed = drainMessages(sender)
            }
            assertTrue(closed.any { it.contains("1 editor session") }, "Console sessions are closed: $closed")
            assertNull(plugin.editorSessions.find(session.id))
        } finally {
            plugin.stopEditor()
        }
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
