package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.MockPlugin
import org.bukkit.plugin.PluginDescriptionFile
import java.io.StringReader
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

class SuitePluginsAnnouncementTest {
    @BeforeTest
    fun setup() {
        MockBukkit.mock()
    }

    @AfterTest
    fun teardown() {
        MockBukkit.unmock()
    }

    private fun plugin(yml: String) = MockBukkit.loadWith(MockPlugin::class.java, PluginDescriptionFile(StringReader(yml)))

    @Test
    fun `the inventory lists Artisan, then the plugins that depend on it, directly or not`() {
        val artisan = MockBukkit.load(ArtisanPlugin::class.java)
        plugin("name: Quests\nversion: '1.2'\nmain: be.seeseemelk.mockbukkit.MockPlugin\ndepend: [Artisan]")
        plugin("name: GuildQuests\nversion: '0.3'\nmain: be.seeseemelk.mockbukkit.MockPlugin\ndepend: [Quests]")
        plugin("name: Unrelated\nversion: '9'\nmain: be.seeseemelk.mockbukkit.MockPlugin")
        artisan.announcementChanged()

        val plugins = artisan.announcement().suitePlugins
        assertEquals(listOf("Artisan", "Quests", "GuildQuests"), plugins.map { it["name"] })
        assertEquals(mapOf("name" to "GuildQuests", "version" to "0.3", "enabled" to true, "depends" to listOf("Quests")), plugins[2])
    }
}
