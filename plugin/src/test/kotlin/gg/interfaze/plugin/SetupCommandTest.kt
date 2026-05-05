package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertTrue

class SetupCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest  fun teardown() { MockBukkit.unmock() }

    @Test
    fun `setup command without args is accepted from console`() {
        val plugin = MockBukkit.load(InterfazePlugin::class.java)
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("ifz")!!
        // /ifz setup with no ws_url configured — should not throw, just return true
        val result = cmd.executor!!.onCommand(sender, cmd, "ifz", arrayOf("setup"))
        assertTrue(result, "Command should return true (accepted)")
    }

    @Test
    fun `setup command with code is accepted from console`() {
        val plugin = MockBukkit.load(InterfazePlugin::class.java)
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("ifz")!!
        val result = cmd.executor!!.onCommand(sender, cmd, "ifz", arrayOf("setup", "ABCD1234"))
        assertTrue(result, "Command should return true (accepted)")
    }
}
