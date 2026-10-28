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
        // The plugin is 1.0.0-SNAPSHOT; the API is 2.0.0: only the API version satisfies 2.0.0.
        assertTrue(plugin.api.isCompatibleWith(plugin.api.apiVersion))
        assertTrue(plugin.api.isCompatibleWith("2.0.0"))
        // An add-on built against API 1.x needs the Kotlin surface: a major bump refuses it.
        assertFalse(plugin.api.isCompatibleWith("1.7.0"))
        assertFalse(plugin.api.isCompatibleWith("3.0.0"))
    }

    @Test
    fun `an add-on's module is disabled and unregistered when its plugin disables`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        var disabled = false
        plugin.api.modules.register(object : net.artisanmc.modules.api.ArtisanModule {
            override fun getId() = "homes"
            override fun getSchemaVersion() = "homes/v1"
            override fun onEnable(api: ArtisanAPI) {
                api.commands.register(net.artisanmc.modules.api.command.CommandDeclaration("homes:go") { _, _ -> })
            }
            override fun onDisable() { disabled = true }
        })

        // MockBukkit gives a mock plugin its own class loader; this proxy is defined by the
        // test's, like the module above (and Artisan's own modules, which go too here).
        val addon = java.lang.reflect.Proxy.newProxyInstance(javaClass.classLoader, arrayOf(org.bukkit.plugin.Plugin::class.java)) { _, method, _ ->
            when (method.returnType) {
                java.lang.Boolean.TYPE -> true
                Integer.TYPE -> 0
                String::class.java -> "Homes"
                else -> null
            }
        } as org.bukkit.plugin.Plugin
        plugin.server.pluginManager.callEvent(org.bukkit.event.server.PluginDisableEvent(addon))

        assertTrue(disabled)
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
