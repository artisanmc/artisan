package net.artisanmc.modules.menus

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.*
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.ArtisanPlugin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class MenusModuleTest {

    private lateinit var plugin: ArtisanPlugin

    @BeforeEach fun setup() {
        MockBukkit.mock()
        plugin = MockBukkit.load(ArtisanPlugin::class.java)
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
        val reg = ModuleRegistry()
        val api = ArtisanAPI(
            plugin = plugin,
            dataSources = DataSourceRegistry(),
            commands = CommandRegistry(),
            events = ModuleEventBus(),
            schemas = SchemaRegistry(),
            modules = reg,
            coreVersion = "1.0.0",
            project = object : net.artisanmc.modules.api.ProjectContentApi {
                override fun projectIds() = emptyList<String>()
                override fun list(projectId: String, dir: String) = emptyList<String>()
                override fun read(projectId: String, relPath: String): String? = null
                override fun hasContent(dir: String) = false
            },
        )
        reg.bind(api) {}
        module.onEnable(api)
    }
}
