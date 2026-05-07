package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import gg.interfaze.plugin.command.ArgDef
import gg.interfaze.plugin.command.ArgParser
import kotlin.test.*

class ArgParserTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private fun player() = MockBukkit.getMock()!!.addPlayer()

    @Test fun `parse string arg`() {
        val defs = listOf(ArgDef.StringArg("message"))
        val result = ArgParser.parse(defs, arrayOf("hello"), MockBukkit.getMock()!!.addPlayer())
        assertNotNull(result)
        assertEquals("hello", result["message"])
    }

    @Test fun `parse multiple string args joined`() {
        val defs = listOf(ArgDef.StringArg("word1"), ArgDef.StringArg("rest"))
        val result = ArgParser.parse(defs, arrayOf("foo", "bar", "baz"), MockBukkit.getMock()!!.addPlayer())
        assertNotNull(result)
        assertEquals("foo", result["word1"])
        assertEquals("bar baz", result["rest"])
    }

    @Test fun `parse int arg`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val result = ArgParser.parse(defs, arrayOf("42"), MockBukkit.getMock()!!.addPlayer())
        assertNotNull(result)
        assertEquals(42, result["amount"])
    }

    @Test fun `parse int arg with invalid value returns null`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val sender = MockBukkit.getMock()!!.addPlayer()
        val result = ArgParser.parse(defs, arrayOf("notanumber"), sender)
        assertNull(result)
    }

    @Test fun `parse enum arg valid value`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver", "gold")))
        val result = ArgParser.parse(defs, arrayOf("silver"), MockBukkit.getMock()!!.addPlayer())
        assertNotNull(result)
        assertEquals("silver", result["tier"])
    }

    @Test fun `parse enum arg invalid value returns null`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver")))
        val sender = MockBukkit.getMock()!!.addPlayer()
        val result = ArgParser.parse(defs, arrayOf("diamond"), sender)
        assertNull(result)
    }

    @Test fun `parse player arg online player`() {
        val target = player()
        val defs = listOf(ArgDef.PlayerArg("target"))
        val result = ArgParser.parse(defs, arrayOf(target.name), MockBukkit.getMock()!!.addPlayer())
        assertNotNull(result)
        assertEquals(target, result["target"])
    }

    @Test fun `parse player arg offline player returns null`() {
        val defs = listOf(ArgDef.PlayerArg("target"))
        val sender = MockBukkit.getMock()!!.addPlayer()
        val result = ArgParser.parse(defs, arrayOf("OfflineGhost"), sender)
        assertNull(result)
    }

    @Test fun `parse required arg missing returns null`() {
        val defs = listOf(ArgDef.StringArg("name", required = true))
        val sender = MockBukkit.getMock()!!.addPlayer()
        val result = ArgParser.parse(defs, emptyArray(), sender)
        assertNull(result)
    }

    @Test fun `parse optional arg missing uses default`() {
        val defs = listOf(ArgDef.StringArg("lang", required = false, default = "en"))
        val result = ArgParser.parse(defs, emptyArray(), MockBukkit.getMock()!!.addPlayer())
        assertNotNull(result)
        assertEquals("en", result["lang"])
    }

    @Test fun `parse optional arg missing with null default is absent from map`() {
        val defs = listOf(ArgDef.StringArg("opt", required = false, default = null))
        val result = ArgParser.parse(defs, emptyArray(), MockBukkit.getMock()!!.addPlayer())
        assertNotNull(result)
        assertFalse(result.containsKey("opt"))
    }

    @Test fun `tabComplete enum returns matching values`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver", "gold")))
        val completions = ArgParser.tabComplete(defs, arrayOf("s"))
        assertEquals(listOf("silver"), completions)
    }

    @Test fun `tabComplete player returns online players`() {
        val target = player()
        val defs = listOf(ArgDef.PlayerArg("target"))
        val completions = ArgParser.tabComplete(defs, arrayOf(target.name.take(2)))
        assertTrue(target.name in completions)
    }

    @Test fun `tabComplete empty for string arg`() {
        val defs = listOf(ArgDef.StringArg("message"))
        val completions = ArgParser.tabComplete(defs, arrayOf(""))
        assertTrue(completions.isEmpty())
    }
}
