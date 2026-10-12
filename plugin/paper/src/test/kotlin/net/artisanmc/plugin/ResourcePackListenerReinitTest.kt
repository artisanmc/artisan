package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.resourcepack.ResourcePackManager
import org.bukkit.event.HandlerList
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class ResourcePackListenerReinitTest {

    @BeforeEach fun setup() { MockBukkit.mock() }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    /**
     * Distinct [ResourcePackManager] instances currently subscribed to Bukkit events for this
     * plugin. One instance registers one handler per `@EventHandler` method, so dedupe by identity.
     */
    private fun registeredManagers(plugin: ArtisanPlugin): List<ResourcePackManager> =
        HandlerList.getRegisteredListeners(plugin)
            .mapNotNull { it.listener as? ResourcePackManager }
            .distinctBy { System.identityHashCode(it) }

    @Test
    fun `reinit does not accumulate resource pack listeners`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val afterEnable = registeredManagers(plugin).size
        assertEquals(1, afterEnable)

        plugin.reloadConfig()
        plugin.reinit(PluginConfig.from(plugin.config))
        plugin.reloadConfig()
        plugin.reinit(PluginConfig.from(plugin.config))

        // Each `/artisan reload` must replace the listener, not stack another one:
        // a stale instance keeps pushing to players with the pre-reload settings.
        assertEquals(afterEnable, registeredManagers(plugin).size)
    }
}
