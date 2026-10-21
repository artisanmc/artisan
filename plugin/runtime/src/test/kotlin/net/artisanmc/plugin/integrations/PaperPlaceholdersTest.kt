package net.artisanmc.plugin.integrations

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.placeholder.PlaceholderResolver
import kotlin.test.*

class PaperPlaceholdersTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    @Test fun `the namespaces a disabling plugin loaded are removed, and can be registered again`() {
        val placeholders = PaperPlaceholders(MockBukkit.createMockPlugin("Artisan"))
        val player = MockBukkit.getMock()!!.addPlayer()
        placeholders.register("homes") { _, key -> "home:$key" }

        assertEquals(emptyList(), placeholders.unregisterLoadedBy(java.net.URLClassLoader(arrayOf())))
        assertEquals(listOf("homes"), placeholders.unregisterLoadedBy(javaClass.classLoader))
        assertEquals("%homes_base%", placeholders.resolve(player, "%homes_base%"))

        placeholders.register("homes", PlaceholderResolver { _, key -> "again:$key" })
        assertEquals("again:base", placeholders.resolve(player, "%homes_base%"))
    }
}
