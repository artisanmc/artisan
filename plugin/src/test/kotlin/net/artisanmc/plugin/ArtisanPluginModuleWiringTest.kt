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
        val api = ArtisanPlugin.buildApi(plugin)
        assertNotNull(api.dataSources)
        assertNotNull(api.commands)
        assertNotNull(api.events)
        assertNotNull(api.schemas)
    }

    @Test
    fun `default module list contains menus and commands`() {
        val ids = ArtisanPlugin.defaultModules().map { it.id }
        assertTrue("menus" in ids)
        assertTrue("commands" in ids)
    }
}
