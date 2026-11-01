package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

/** ADR `triggers-and-variables` §6: typed arguments resolved by template, and a refusal rather than a default. */
class ArgCoercionTest {
    private val bindings = mapOf(
        "row.price" to 12.5,
        "row.count" to 3,
        "flag" to "true",
        "event.location" to LocationValue("world", 1.0, 64.0, -3.5),
    )
    private val resolver = object : ArgCoercion.Resolver {
        override fun value(expr: String): Any? = bindings[expr]
        override fun text(template: String): String =
            Regex("\\{([^}]+)}").replace(template) { bindings[it.groupValues[1]]?.toString() ?: "" }
    }
    private val decl = listOf(
        ModelField("amount", ModelFieldType.number()),
        ModelField("count", ModelFieldType.integer()),
        ModelField("on", ModelFieldType.bool()),
        ModelField("location", ModelFieldType.location()),
        ModelField("text", ModelFieldType.string()),
    )

    private fun ok(args: Map<String, Any>) = assertIs<ArgCoercion.Result.Ok>(ArgCoercion.coerce(decl, args, resolver)).args
    private fun failed(args: Map<String, Any>) = assertIs<ArgCoercion.Result.Failed>(ArgCoercion.coerce(decl, args, resolver)).failure

    @Test fun `typed values pass unchanged, untyped arguments are not touched`() {
        val args = mapOf("amount" to 5, "count" to 2, "on" to true, "text" to "{row.price}")
        assertEquals(args, ok(args))
    }

    @Test fun `a lone expression keeps its type, a mixed template is rendered then read`() {
        assertEquals(mapOf("amount" to 12.5, "count" to 3L, "on" to true), ok(mapOf("amount" to "{row.price}", "count" to "{row.count}", "on" to "{flag}")))
        assertEquals(mapOf("amount" to 1.5), ok(mapOf("amount" to "1.5")))
        assertEquals(mapOf("count" to 3L), ok(mapOf("count" to " {row.count} ")))
    }

    @Test fun `a location reads from an expression, a text or fields that are templates`() {
        val expected = LocationValue("world", 1.0, 64.0, -3.5)
        assertEquals(expected, ok(mapOf("location" to "{event.location}"))["location"])
        assertEquals(expected, ok(mapOf("location" to "world 1 64 -3.5"))["location"])
        assertEquals(
            LocationValue("world", 3.0, 64.0, -3.5),
            ok(mapOf("location" to mapOf("world" to "world", "x" to "{row.count}", "y" to 64, "z" to -3.5)))["location"],
        )
    }

    @Test fun `what does not resolve to its type is a failure naming the argument, never a default`() {
        assertEquals("amount", failed(mapOf("amount" to "{missing}")).arg)
        assertEquals("count", failed(mapOf("count" to "{row.price}")).arg, "12.5 is not an integer")
        assertEquals("on", failed(mapOf("on" to "maybe")).arg)
        assertEquals("location", failed(mapOf("location" to "{row.price}")).arg)
        assertEquals("location", failed(mapOf("location" to mapOf("x" to 1, "y" to 2, "z" to 3))).arg, "no world")
    }

    @Test fun `location values read as a map and as a place in a text`() {
        val l = LocationValue.from(mapOf("world" to "nether", "x" to 1, "y" to 2.5, "z" to "3", "yaw" to 90))!!
        assertEquals("nether 1 2.5 3", l.toString())
        assertEquals(90.0, l["yaw"])
        assertEquals(l, LocationValue.from(l.toString())?.let { LocationValue(it.world, it.x, it.y, it.z, 90.0, 0.0) })
        assertNull(LocationValue.from("nether 1 2"))
        assertNull(LocationValue.from(mapOf("world" to "w", "x" to "a", "y" to 1, "z" to 1)))
    }
}
