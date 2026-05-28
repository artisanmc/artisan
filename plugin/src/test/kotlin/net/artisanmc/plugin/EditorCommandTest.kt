package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertTrue

class EditorCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest  fun teardown() { MockBukkit.unmock() }

    @Test
    fun `editor subcommand is accepted without exception`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        val result = cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("editor"))
        assertTrue(result, "Command should return true")
    }

    @Test
    fun `editor revoke subcommand is accepted without exception`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val sender = MockBukkit.getMock()!!.consoleSender
        val cmd = plugin.getCommand("artisan")!!
        val result = cmd.executor!!.onCommand(sender, cmd, "artisan", arrayOf("editor", "revoke"))
        assertTrue(result, "Command should return true")
    }
}
