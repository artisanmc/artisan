package net.artisanmc.modules.api

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.command.CommandDeclaration
import net.artisanmc.modules.api.command.CommandRegistry
import net.artisanmc.modules.api.datasource.DataSourceDeclaration
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.event.ModuleEventBus
import net.artisanmc.modules.api.project.ProjectContentApi
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.ArtisanPlugin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class ModuleRegistryTest {

    @BeforeEach fun setUp() { MockBukkit.mock() }
    @AfterEach fun tearDown() { MockBukkit.unmock() }

    private fun module(moduleId: String, declare: (ArtisanAPI) -> Unit = {}) = object : ArtisanModule {
        override fun getId() = moduleId
        override fun getSchemaVersion() = "$moduleId/v1"
        var enabled = false
        var disabled = false
        override fun onEnable(api: ArtisanAPI) { enabled = true; declare(api) }
        override fun onDisable() { disabled = true }
    }

    private lateinit var api: ArtisanAPI

    /** Builds a throwaway bound registry backed by a real MockBukkit plugin. */
    private fun boundRegistry(onChange: () -> Unit = {}): ModuleRegistry {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val reg = ModuleRegistry()
        val api = ArtisanAPI.builder(
            plugin,
            DataSourceRegistry(),
            CommandRegistry(),
            ModuleEventBus(),
            SchemaRegistry(),
            reg,
            "1.0.0",
            object : ProjectContentApi {
                override fun projectIds() = emptyList<String>()
                override fun list(projectId: String, dir: String) = emptyList<String>()
                override fun read(projectId: String, relPath: String): String? = null
                override fun hasContent(dir: String) = false
            },
        )
            .build()
        reg.bind(api, onChange)
        this.api = api
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

    @Test fun `unregister disables the module and drops what it registered`() {
        var changes = 0
        val reg = boundRegistry { changes++ }
        val m = module("quests") {
            it.dataSources.register(DataSourceDeclaration("quests:list", { _, _ -> emptyList() }))
            it.commands.register(CommandDeclaration("quests:start") { _, _ -> })
            it.models.declare(mapOf("id" to "quests:quest"))
            it.editorBundles.register(net.artisanmc.modules.api.editor.EditorBundleDeclaration("export default {}".toByteArray(), "1.0"))
        }
        reg.register(m)
        assertNotNull(api.editorBundles.find("quests"))
        api.dataSources.register(DataSourceDeclaration("other:list", { _, _ -> emptyList() }))

        assertTrue(reg.unregister("quests"))

        assertTrue(m.disabled)
        assertFalse(reg.has("quests"))
        assertEquals(setOf("other:list"), api.dataSources.refs())
        assertFalse(api.commands.has("quests:start"))
        assertFalse(api.models.has("quests:quest"))
        assertNull(api.editorBundles.find("quests"))
        assertEquals(2, changes)
        reg.register(module("quests"))
        assertTrue(reg.has("quests"))
    }

    @Test fun `unregister of an unknown id is false`() {
        assertFalse(boundRegistry().unregister("ghost"))
    }

    @Test fun `unregisterLoadedBy only touches what that loader loaded`() {
        val reg = boundRegistry()
        reg.register(module("quests"))
        api.commands.register(CommandDeclaration("free:cmd") { _, _ -> })

        assertTrue(reg.unregisterLoadedBy(ClassLoader.getPlatformClassLoader()).isEmpty())
        assertTrue(reg.has("quests"))

        reg.unregisterLoadedBy(javaClass.classLoader)
        assertFalse(reg.has("quests"))
        assertFalse(api.commands.has("free:cmd"))
    }

    @Test fun `has is false for unknown`() {
        val reg = boundRegistry()
        assertFalse(reg.has("ghost"))
    }
}
