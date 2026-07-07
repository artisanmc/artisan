package net.artisanmc.modules.api

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.ArtisanPlugin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class ModuleRegistryTest {

    @BeforeEach fun setUp() { MockBukkit.mock() }
    @AfterEach fun tearDown() { MockBukkit.unmock() }

    private fun module(moduleId: String) = object : ArtisanModule {
        override val id = moduleId
        override val schemaVersion = "$moduleId/v1"
        var enabled = false
        override fun onEnable(api: ArtisanAPI) { enabled = true }
        override fun onDisable() {}
    }

    /** Builds a throwaway bound registry backed by a real MockBukkit plugin. */
    private fun boundRegistry(onChange: () -> Unit = {}): ModuleRegistry {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val reg = ModuleRegistry()
        val api = ArtisanAPI(
            plugin = plugin,
            dataSources = DataSourceRegistry(),
            commands = CommandRegistry(),
            events = ModuleEventBus(),
            schemas = SchemaRegistry(),
            modules = reg,
            coreVersion = "1.0.0",
            project = object : ProjectContentApi {
                override fun projectIds() = emptyList<String>()
                override fun list(projectId: String, dir: String) = emptyList<String>()
                override fun read(projectId: String, relPath: String): String? = null
                override fun hasContent(dir: String) = false
            },
        )
        reg.bind(api, onChange)
        return reg
    }

    @Test fun `register enables, lists, and signals change`() {
        var changes = 0
        val reg = boundRegistry { changes++ }
        val m = module("quests")
        reg.register(m)
        assertTrue(reg.has("quests"))
        assertEquals(listOf("quests"), reg.active().map { it.id })
        assertEquals(1, changes)
        assertTrue(m.enabled)
    }

    @Test fun `duplicate id throws`() {
        val reg = boundRegistry()
        reg.register(module("quests"))
        assertThrows(DuplicateModuleException::class.java) { reg.register(module("quests")) }
    }

    @Test fun `unbound registry errors on register`() {
        val reg = ModuleRegistry()
        assertThrows(IllegalStateException::class.java) { reg.register(module("quests")) }
    }

    @Test fun `has is false for unknown`() {
        val reg = boundRegistry()
        assertFalse(reg.has("ghost"))
    }
}
