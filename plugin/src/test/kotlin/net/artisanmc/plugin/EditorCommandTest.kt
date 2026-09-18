package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.provider.MenuProvider
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.entity.Player
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EditorCommandTest {

    private val plain = PlainTextComponentSerializer.plainText()

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest  fun teardown() { MockBukkit.unmock() }

    /** Stub [MenuProvider] whose [editorInfo] can be fixed per test. */
    private class StubProvider(private val info: Pair<String, String>?) : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<ProjectBundle> = emptyList()
        override fun editorInfo(): Pair<String, String>? = info
    }

    private fun drainMessages(sender: be.seeseemelk.mockbukkit.command.ConsoleCommandSenderMock): List<String> {
        val out = mutableListOf<String>()
        while (true) {
            val next = sender.nextComponentMessage() ?: break
            out += plain.serialize(next)
        }
        return out
    }

    @Test
    fun `editor on a linked server prints the server deep link and network name`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        plugin.setMenuProviderForTesting(StubProvider("http://localhost:5173/networks/my-net/servers/my-server" to "Test"))
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        val result = cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("editor"))
        assertTrue(result, "Command should return true")

        val messages = drainMessages(sender)
        assertTrue(messages.any { it.contains("http://localhost:5173/networks/my-net/servers/my-server") }, "Expected the server deep link in output: $messages")
        assertTrue(messages.any { it.contains("Test") }, "Expected the network name in output: $messages")
    }

    @Test
    fun `editor on a keyless server routes to the link flow hint`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        plugin.setMenuProviderForTesting(StubProvider(null))
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        val result = cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("editor"))
        assertTrue(result, "Command should return true (no exception)")

        val messages = drainMessages(sender)
        assertTrue(messages.any { it.contains("editor.artisanmc.net") },
            "Expected the browsable editor host in the hint: $messages")
        assertFalse(messages.any { it.contains("api.artisanmc.net") },
            "The backend host is not browsable and must not be advertised: $messages")
    }

    @Test
    fun `editor on a linked-but-not-connected server shows connecting message and does not trigger setup`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        // Simulate a linked server (has server_key) but backend is not yet reachable (editorInfo() is null)
        plugin.config.set("server_key", "sk_" + "a".repeat(64))
        plugin.setMenuProviderForTesting(StubProvider(null))
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        val result = cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("editor"))
        assertTrue(result, "Command should return true")

        val messages = drainMessages(sender)
        assertTrue(messages.any { it.contains("connected", ignoreCase = true) || it.contains("connecté", ignoreCase = true) },
            "Expected a connected/connecté message: $messages")
        assertFalse(messages.any { it.contains("already linked", ignoreCase = true) || it.contains("déjà lié", ignoreCase = true) },
            "Should NOT show setup-rejection message: $messages")
        assertFalse(messages.any { it.contains("not linked", ignoreCase = true) || it.contains("non lié", ignoreCase = true) || it.contains("pas encore lié", ignoreCase = true) },
            "Should NOT show 'not linked' or link-flow message: $messages")
    }

    @Test
    fun `trusteditor is no longer a subcommand`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        val result = cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("trusteditor", "X"))
        assertTrue(result, "Command should return true")

        val messages = drainMessages(sender)
        assertTrue(messages.any { it.contains("Usage") }, "Expected fallback usage message: $messages")
        assertFalse(messages.any { it.contains("trust", ignoreCase = true) && it.contains("sent", ignoreCase = true) })
    }
}
