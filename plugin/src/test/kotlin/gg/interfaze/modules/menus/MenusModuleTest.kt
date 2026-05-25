package gg.interfaze.modules.menus

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.modules.api.*
import gg.interfaze.plugin.InterfazePlugin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class MenusModuleTest {

    private lateinit var plugin: InterfazePlugin

    @BeforeEach fun setup() {
        MockBukkit.mock()
        plugin = MockBukkit.load(InterfazePlugin::class.java)
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `module id is 'menus' and schema is 'menu_v1'`() {
        val module = MenusModule()
        assertEquals("menus", module.id)
        assertEquals("menu/v1", module.schemaVersion)
    }

    @Test
    fun `onEnable does not throw with a real plugin API`() {
        val module = MenusModule()
        val api = InterfazeAPI(
            plugin = plugin,
            dataSources = DataSourceRegistry(),
            commands = CommandRegistry(),
            events = ModuleEventBus(),
        )
        module.onEnable(api)
    }
}
