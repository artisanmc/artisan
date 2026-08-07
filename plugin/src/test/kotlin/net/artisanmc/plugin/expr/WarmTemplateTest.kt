package net.artisanmc.plugin.expr

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Bundle-load pre-parsing (ADR `expression-parity` §2): the point is that a
 * broken expression is found when the project loads, not when a player opens the
 * menu.
 */
class WarmTemplateTest {

    @Test
    fun `a sound template reports nothing`() {
        assertEquals(emptyList<String>(), warmTemplate("Price: {item.price} coins"))
        assertEquals(emptyList<String>(), warmTemplate("{rewards.pluck(\"name\").join(\"\\n\")}"))
    }

    @Test
    fun `plain text reports nothing`() {
        assertEquals(emptyList<String>(), warmTemplate("just words"))
    }

    @Test
    fun `a malformed expression is reported with its source`() {
        val problems = warmTemplate("before {a +} after")

        assertEquals(1, problems.size)
        assertTrue(problems[0].startsWith("{a +}"), "should name the offending segment: ${problems[0]}")
    }

    @Test
    fun `every malformed segment of a line is reported`() {
        assertEquals(2, warmTemplate("{a +} and {b *}").size)
    }

    /** An unbound identifier is not a malformation — it is reported at render, visibly. */
    @Test
    fun `an unknown identifier is not a parse problem`() {
        assertEquals(emptyList<String>(), warmTemplate("{totally_unknown}"))
    }

    @Test
    fun `warming makes the cache serve the same parse`() {
        val expr = "item.price + 1"
        warmTemplate("{$expr}")

        assertTrue(ExprCache.get(expr) is Node, "warmed expression should be a parsed AST")
    }
}
