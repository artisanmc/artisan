package net.artisanmc.plugin

import net.artisanmc.plugin.engine.Condition
import net.artisanmc.plugin.engine.ServerVariants
import net.artisanmc.plugin.engine.VariantPlayer
import net.artisanmc.plugin.engine.VariantRule
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** The variants declared by the server, and the one each player sees in every module. */
class ServerVariantsTest {

    private fun player(
        bedrock: Boolean = false,
        pack: Boolean = false,
        perms: Set<String> = emptySet(),
        choice: String? = null,
    ) = object : VariantPlayer {
        override val bedrock = bedrock
        override val hasPack = pack
        override val preference = choice
        override fun hasPermission(permission: String) = permission in perms
        override fun test(condition: Condition): Boolean = when (condition) {
            is Condition.HasPermission -> condition.perm in perms
            is Condition.ClientIs -> (condition.client == "bedrock") == bedrock
            Condition.HasResourcePack -> pack
            is Condition.Not -> !test(condition.inner)
            else -> false
        }
    }

    private fun parse(vararg entries: Map<String, Any?>) = ServerVariants.parse(entries.toList())

    private val builtIn = ServerVariants()

    @Test
    fun `in auto, bedrock for Geyser players, textured with the pack, default otherwise`() {
        assertEquals("bedrock", builtIn.auto(player(bedrock = true, pack = true)))
        assertEquals("textured", builtIn.auto(player(pack = true)))
        assertEquals("default", builtIn.auto(player()))
    }

    @Test
    fun `a module without a version for the variant falls back to the module's own file`() {
        val has = { v: String -> v == "bedrock" }
        assertEquals("bedrock", builtIn.select(emptyList(), has, player(bedrock = true)))
        assertNull(builtIn.select(emptyList(), has, player(pack = true)))
    }

    @Test
    fun `a custom variant falls back along its parents`() {
        val v = parse(mapOf("name" to "winter", "parent" to "textured", "if" to listOf(mapOf("has_permission" to "event.winter")))).variants
        assertEquals(listOf("winter", "textured"), v.chain("winter"))
        val winterPlayer = player(pack = true, perms = setOf("event.winter"))
        assertEquals("winter", v.auto(winterPlayer))
        assertEquals("winter", v.select(emptyList(), { true }, winterPlayer))
        assertEquals("textured", v.select(emptyList(), { it == "textured" }, winterPlayer))
        assertNull(v.select(emptyList(), { it == "bedrock" }, winterPlayer))
        // Its parent needs the pack: without it, neither winter nor textured.
        assertEquals("default", v.auto(player(perms = setOf("event.winter"))))
    }

    @Test
    fun `a player's choice wins over auto, in every module`() {
        val has = { _: String -> true }
        // The pack loaded but draws wrong: the player asks for the plain menus.
        assertNull(builtIn.select(emptyList(), has, player(pack = true, choice = "default")))
        assertEquals("textured", builtIn.select(emptyList(), has, player(pack = true, choice = "auto")))
    }

    @Test
    fun `a choice the player cannot see any more is ignored`() {
        val has = { _: String -> true }
        // Chose textured, then the pack failed: the plain menus, not missing glyphs.
        assertNull(builtIn.select(emptyList(), has, player(pack = false, choice = "textured")))
        assertEquals("bedrock", builtIn.select(emptyList(), has, player(bedrock = true, choice = "textured")))
        assertNull(builtIn.select(emptyList(), has, player(choice = "removed")))
    }

    @Test
    fun `offered is what the player's client can show, and the variants open to them`() {
        val v = parse(
            mapOf("name" to "vip", "if" to listOf(mapOf("has_permission" to "rank.vip"))),
            mapOf("name" to "large", "selectable" to true),
            mapOf("name" to "dev", "selectable" to false),
        ).variants
        assertEquals(listOf("default", "textured", "large"), v.offered(player(pack = true)))
        assertEquals(listOf("default", "bedrock", "vip", "large"), v.offered(player(bedrock = true, perms = setOf("rank.vip"))))
        // `large` has no conditions: never picked in auto, only chosen.
        assertEquals("default", v.auto(player()))
        assertEquals("large", v.current(player(choice = "large")))
    }

    @Test
    fun `a module's own display rules stay in force until the player chooses`() {
        val legacy = listOf(VariantRule("textured", "textured", conditions = listOf(Condition.HasPermission("old.rule")), terminal = true))
        val has = { _: String -> true }
        // The module showed textured to `old.rule` only: kept, whatever the pack.
        assertNull(builtIn.select(legacy, has, player(pack = true)))
        assertEquals("textured", builtIn.select(legacy, has, player(perms = setOf("old.rule"))))
        // A choice goes through the server's variants.
        assertNull(builtIn.select(legacy, has, player(perms = setOf("old.rule"), choice = "default")))
    }

    @Test
    fun `bad entries are reported and left out, the others load`() {
        val parsed = parse(
            mapOf("name" to "textured"),
            mapOf("name" to "Bad Name"),
            mapOf("name" to "a", "parent" to "b"),
            mapOf("name" to "b", "parent" to "a"),
            mapOf("name" to "c", "parent" to "nowhere"),
            mapOf("name" to "d", "parent" to "c"),
            mapOf("name" to "e", "color" to "red"),
            mapOf("name" to "ok", "parent" to "bedrock"),
        )
        assertEquals(listOf("ok"), parsed.variants.custom.map { it.name })
        assertEquals(7, parsed.problems.size, parsed.problems.joinToString("\n"))
        assertTrue(parsed.problems.any { "'textured' is built in" in it })
        assertEquals(listOf("default", "bedrock", "textured", "ok"), parsed.variants.names)
    }

    @Test
    fun `nothing declared gives the three built-in variants`() {
        val parsed = ServerVariants.parse(null)
        assertTrue(parsed.problems.isEmpty())
        assertEquals(ServerVariants.BUILTIN, parsed.variants.names)
    }
}
