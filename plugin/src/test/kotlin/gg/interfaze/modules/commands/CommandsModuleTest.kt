package gg.interfaze.modules.commands

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.modules.api.*
import gg.interfaze.plugin.InterfazePlugin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class CommandsModuleTest {

    private lateinit var plugin: InterfazePlugin

    @BeforeEach fun setup() {
        MockBukkit.mock()
        plugin = MockBukkit.load(InterfazePlugin::class.java)
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `module id is 'commands' and schema is 'command_v1'`() {
        val module = CommandsModule()
        assertEquals("commands", module.id)
        assertEquals("command/v1", module.schemaVersion)
    }

    @Test
    fun `onEnable does not throw with a real plugin API`() {
        val module = CommandsModule()
        val api = InterfazeAPI(
            plugin = plugin,
            dataSources = DataSourceRegistry(),
            commands = CommandRegistry(),
            events = ModuleEventBus(),
        )
        module.onEnable(api)
    }
}
