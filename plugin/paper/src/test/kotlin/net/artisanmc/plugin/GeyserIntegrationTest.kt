package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.entity.PlayerMock
import net.artisanmc.plugin.integrations.GeyserIntegration
import java.io.File
import java.util.UUID
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class GeyserIntegrationTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    @Test fun `without Geyser here, a Floodgate UUID marks a Bedrock player`() {
        val server = MockBukkit.getMock()!!
        val geyser = GeyserIntegration(MockBukkit.createMockPlugin())
        // Floodgate: high bits zero, the Xbox id in the low bits.
        val bedrock = PlayerMock(server, "Steve", UUID(0L, 0x0009_0161_2345_6789L)).also { server.addPlayer(it) }
        val java = PlayerMock(server, "Alex", UUID.randomUUID()).also { server.addPlayer(it) }
        assertTrue(geyser.isBedrock(bedrock))
        assertFalse(geyser.isBedrock(java))
    }

    @Test fun `the mapping is written under Artisan's cache for a Geyser elsewhere`() {
        val plugin = MockBukkit.createMockPlugin()
        GeyserIntegration(plugin).start()
        val file = File(plugin.dataFolder, "cache/geyser/custom_mappings/artisan.json")
        assertEquals(GeyserIntegration.MAPPINGS, file.readText())
    }
}
