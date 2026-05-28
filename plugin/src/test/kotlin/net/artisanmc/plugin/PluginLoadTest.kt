package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertNotNull

class PluginLoadTest {
    @BeforeTest
    fun setup() {
        MockBukkit.mock()
    }

    @AfterTest
    fun teardown() {
        MockBukkit.unmock()
    }

    @Test
    fun `plugin loads without throwing`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        assertNotNull(plugin)
    }
}
