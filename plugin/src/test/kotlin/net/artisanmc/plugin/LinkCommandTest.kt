package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertTrue

class LinkCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest  fun teardown() { MockBukkit.unmock() }

    @Test
    fun `link without a code is accepted (prints usage)`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        val result = cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("link"))
        assertTrue(result, "Command should return true (accepted)")
    }

    @Test
    fun `link with a code is accepted`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        // Redeem runs async against ws_url's derived host; the command just returns true.
        val result = cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("link", "ABCD1234"))
        assertTrue(result, "Command should return true (accepted)")
    }
}
