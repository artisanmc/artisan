package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.command.ArgDef
import net.artisanmc.plugin.command.ArgParser
import net.artisanmc.plugin.lang.LangManager
import kotlin.test.*

class ArgParserTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val lang = LangManager(emptyMap(), "en", false)
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    @Test fun `parse string arg`() {
        val defs = listOf(ArgDef.StringArg("message"))
        val result = ArgParser.parse(defs, arrayOf("hello"), player(), lang)
        assertNotNull(result)
        assertEquals("hello", result["message"])
    }

    @Test fun `parse multiple string args joined`() {
        val defs = listOf(ArgDef.StringArg("word1"), ArgDef.StringArg("rest"))
        val result = ArgParser.parse(defs, arrayOf("foo", "bar", "baz"), player(), lang)
        assertNotNull(result)
        assertEquals("foo", result["word1"])
        assertEquals("bar baz", result["rest"])
    }

    @Test fun `parse int arg`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val result = ArgParser.parse(defs, arrayOf("42"), player(), lang)
        assertNotNull(result)
        assertEquals(42, result["amount"])
    }

    @Test fun `parse int arg with invalid value returns null`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val result = ArgParser.parse(defs, arrayOf("notanumber"), player(), lang)
        assertNull(result)
    }

    @Test fun `parse int arg invalid sends localized message`() {
        val defs = listOf(ArgDef.IntArg("amount"))
        val result = ArgParser.parse(defs, arrayOf("notanumber"), player(), lang)
        assertNull(result)
    }

    @Test fun `parse enum arg valid value`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver", "gold")))
        val result = ArgParser.parse(defs, arrayOf("silver"), player(), lang)
        assertNotNull(result)
        assertEquals("silver", result["tier"])
    }

    @Test fun `parse enum arg invalid value returns null`() {
        val defs = listOf(ArgDef.EnumArg("tier", values = listOf("bronze", "silver")))
        val result = ArgParser.parse(defs, arrayOf("diamond"), player(), lang)
        assertNull(result)
    }

    @Test fun `parse player arg online player`() {
        val target = player()
        val defs = listOf(ArgDef.PlayerArg("target"))
        val result = ArgParser.parse(defs, arrayOf(target.name), player(), lang)
        assertNotNull(result)
        assertEquals(target, result["target"])
    }

    @Test fun `parse player arg offline player returns null`() {
        val defs = listOf(ArgDef.PlayerArg("target"))
        val result = ArgParser.parse(defs, arrayOf("OfflineGhost"), player(), lang)
        assertNull(result)
    }

    @Test fun `parse required arg missing returns null`() {
        val defs = listOf(ArgDef.StringArg("name", required = true))
        val result = ArgParser.parse(defs, emptyArray(), player(), lang)
        assertNull(result)
    }

    @Test fun `parse optional arg missing uses default`() {
        val defs = listOf(ArgDef.StringArg("lang", required = false, default = "en"))
        val result = ArgParser.parse(defs, emptyArray(), player(), lang)
        assertNotNull(result)
        assertEquals("en", result["lang"])
    }

    @Test fun `parse optional arg missing with null default is absent from map`() {
        val defs = listOf(ArgDef.StringArg("opt", required = false, default = null))
        val result = ArgParser.parse(defs, emptyArray(), player(), lang)
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

    @Test fun `parse number and boolean args`() {
        val defs = listOf(ArgDef.NumberArg("price"), ArgDef.BooleanArg("notify"))
        val result = ArgParser.parse(defs, arrayOf("12,5", "yes"), player(), lang)
        assertNotNull(result)
        assertEquals(12.5, result["price"])
        assertEquals(true, result["notify"])
        assertNull(ArgParser.parse(defs, arrayOf("abc", "true"), player(), lang))
        assertNull(ArgParser.parse(defs, arrayOf("1", "maybe"), player(), lang))
    }

    @Test fun `boolean arg completes true and false`() {
        assertEquals(listOf("true"), ArgParser.tabComplete(listOf(ArgDef.BooleanArg("b")), arrayOf("t")))
    }
}

