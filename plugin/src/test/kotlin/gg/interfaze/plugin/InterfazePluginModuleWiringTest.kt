package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.modules.api.InterfazeAPI
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class InterfazePluginModuleWiringTest {

    @BeforeEach fun setup() { MockBukkit.mock() }
    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `plugin exposes an InterfazeAPI after enable`() {
        val plugin = MockBukkit.load(InterfazePlugin::class.java)
        val api = InterfazePlugin.buildApi(plugin)
        assertNotNull(api.dataSources)
        assertNotNull(api.commands)
        assertNotNull(api.events)
    }

    @Test
    fun `default module list contains menus and commands`() {
        val ids = InterfazePlugin.defaultModules().map { it.id }
        assertTrue("menus" in ids)
        assertTrue("commands" in ids)
    }
}
