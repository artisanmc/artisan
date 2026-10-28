package net.artisanmc.modules.commands

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.*
import net.artisanmc.modules.api.command.CommandRegistry
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.event.ModuleEventBus
import net.artisanmc.modules.api.project.ProjectContentApi
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.ArtisanPlugin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class CommandsModuleTest {

    private lateinit var plugin: ArtisanPlugin

    @BeforeEach fun setup() {
        MockBukkit.mock()
        plugin = MockBukkit.load(ArtisanPlugin::class.java)
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
        val reg = ModuleRegistry()
        val api = ArtisanAPI.builder(
            plugin,
            DataSourceRegistry(),
            CommandRegistry(),
            ModuleEventBus(),
            SchemaRegistry(),
            reg,
            "1.0.0",
            object : net.artisanmc.modules.api.project.ProjectContentApi {
                override fun projectIds() = emptyList<String>()
                override fun list(projectId: String, dir: String) = emptyList<String>()
                override fun read(projectId: String, relPath: String): String? = null
                override fun hasContent(dir: String) = false
            },
        )
            .build()
        reg.bind(api) {}
        module.onEnable(api)
    }
}
