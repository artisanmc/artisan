package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.plugin.config.PluginConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.bukkit.plugin.PluginDescriptionFile
import org.junit.jupiter.api.Test

/**
 * The suite's plugins (quests, guilds, lands) depend on Artisan for its API and engine, not
 * for its editor: a failure of the editor side at enable must leave them everything else.
 */
class ArtisanPluginEnableResilienceTest {

    /** An Artisan whose editor cannot start: a port already taken, a missing library, a bad config. */
    open class EditorFailsPlugin : ArtisanPlugin() {
        override fun startEditor(cfg: PluginConfig) {
            throw IllegalStateException("port 8765 already in use")
        }
    }

    private lateinit var server: ServerMock

    @BeforeEach fun setup() { server = MockBukkit.mock() }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `a failing editor leaves the API served, the engine running, menus and the command in place`() {
        // Artisan's own plugin.yml (name, commands, permissions), the subclass as main.
        val description = ArtisanPlugin::class.java.getResourceAsStream("/plugin.yml").use { PluginDescriptionFile(it) }
        val plugin = MockBukkit.loadWith(EditorFailsPlugin::class.java, description)

        assertTrue(plugin.isEnabled)
        assertSame(plugin.api, server.servicesManager.load(ArtisanAPI::class.java))
        assertNotNull(plugin.runtime.executorOrNull, "the action engine runs")
        assertNotNull(plugin.runtime.evaluatorOrNull, "conditions are evaluated")
        assertNotNull(plugin.getCommand("artisan")?.executor, "/artisan answers")
        assertTrue(plugin.api.modules.has("menus"))

        // A module's chain, the way the suite's plugins run their rewards.
        val player = server.addPlayer()
        plugin.api.actions.run(player, listOf(mapOf("send_message" to "reward")), emptyMap(), null)
        server.scheduler.performOneTick()
        assertEquals("reward", player.nextMessage())

        // Disabling is clean too, whatever the editor did.
        assertDoesNotThrow { server.pluginManager.disablePlugin(plugin) }
    }
}
