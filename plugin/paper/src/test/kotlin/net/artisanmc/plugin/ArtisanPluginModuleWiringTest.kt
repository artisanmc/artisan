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
    fun `an add-on's module is disabled and unregistered when its plugin disables`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val addon = MockBukkit.createMockPlugin()
        var disabled = false
        plugin.api.modules.register(object : net.artisanmc.modules.api.ArtisanModule {
            override val id = "homes"
            override val schemaVersion = "homes/v1"
            override fun onEnable(api: ArtisanAPI) {
                api.commands.register(net.artisanmc.modules.api.CommandDeclaration("homes:go") { _, _ -> })
            }
            override fun onDisable() { disabled = true }
        })

        // MockBukkit loads the test, the mock add-on and Artisan's own modules with one
        // class loader: Artisan's modules go too here, unlike on a real server.
        // A MockPlugin is not a JavaPlugin, so disablePlugin() would not fire the event.
        val warnings = mutableListOf<String>()
        val handler = object : java.util.logging.Handler() {
            override fun publish(r: java.util.logging.LogRecord) { warnings += "${r.message} ${r.thrown ?: ""}" }
            override fun flush() {}
            override fun close() {}
        }
        plugin.logger.addHandler(handler)
        plugin.server.pluginManager.callEvent(org.bukkit.event.server.PluginDisableEvent(addon))
        plugin.logger.removeHandler(handler)

        assertTrue(disabled) {
            "active=${plugin.api.modules.active().map { it.id }}, addon loader=${addon.javaClass.classLoader}, " +
                "test loader=${javaClass.classLoader}, logs=$warnings"
        }
        assertFalse(plugin.api.modules.has("homes"))
        assertFalse(plugin.api.commands.has("homes:go"))
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
