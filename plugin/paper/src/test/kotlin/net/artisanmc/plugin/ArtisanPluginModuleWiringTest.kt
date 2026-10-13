package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.ArtisanAPI
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class ArtisanPluginModuleWiringTest {

    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `plugin exposes an ArtisanAPI after enable`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        assertNotNull(plugin.api.dataSources)
        assertNotNull(plugin.api.commands)
        assertNotNull(plugin.api.events)
        assertNotNull(plugin.api.schemas)
        assertNotNull(plugin.api.modules)
    }

    @Test
    fun `default module list contains menus and commands`() {
        val ids = ArtisanPlugin.defaultModules().map { it.id }
        assertTrue("menus" in ids)
        assertTrue("commands" in ids)
    }

    @Test
    fun `core modules flow through registry after enable`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val activeIds = plugin.api.modules.active().map { it.id }
        assertTrue("menus" in activeIds, "expected menus in active modules, got $activeIds")
        assertTrue("commands" in activeIds, "expected commands in active modules, got $activeIds")
    }

    @Test
    fun `isCompatibleWith compares the API version, not the plugin version`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        assertTrue(plugin.api.isCompatibleWith("1.7.0"))
        assertTrue(plugin.api.isCompatibleWith(plugin.api.apiVersion))
        assertFalse(plugin.api.isCompatibleWith("2.0.0"))
    }

    @Test
    fun `ArtisanAPI is exposed via the services manager`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val provided = plugin.server.servicesManager
            .getRegistration(ArtisanAPI::class.java)?.provider
        assertNotNull(provided)
        assertSame(plugin.api, provided)
    }
}
