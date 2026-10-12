package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertTrue

class MemberCommandTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    @Test fun `players cannot authorize accounts even when operator and console mode enabled`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        plugin.config.set("editor.access_mode", "console")
        val player = MockBukkit.getMock()!!.addPlayer()
        player.isOp = true
        val command = plugin.getCommand("artisan")!!
        command.executor!!.onCommand(player, command, "artisan", arrayOf("member", "add", "user@example.com"))
        val message = PlainTextComponentSerializer.plainText().serialize(player.nextComponentMessage()!!)
        assertTrue(message.contains("console", ignoreCase = true), message)
    }

    @Test fun `console cannot add accounts in invitation mode`() {
        val plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val sender = MockBukkit.getMock()!!.consoleSender
        while (sender.nextComponentMessage() != null) { }
        val command = plugin.getCommand("artisan")!!
        command.executor!!.onCommand(sender, command, "artisan", arrayOf("member", "add", "user@example.com"))
        val message = PlainTextComponentSerializer.plainText().serialize(sender.nextComponentMessage()!!)
        assertTrue(message.contains("editor.access_mode"), message)
    }
}
