package net.artisanmc.plugin.actiondsl

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** Unit tests for [evalLeaf] beyond the shared fixtures — notably `%papi%`. */
class LeafEvalTest {

    @Test
    fun `resolves papi placeholder and compares as string`() {
        val papi: (String) -> String? = { name -> if (name == "vault_eco_balance") "250" else null }
        // Numeric string coercion: "250" > 100 → true
        assertTrue(toLeafBoolean(evalLeaf("%vault_eco_balance% > 100", emptyMap(), papi)))
        assertFalse(toLeafBoolean(evalLeaf("%vault_eco_balance% > 300", emptyMap(), papi)))
    }

    @Test
    fun `papi string equality`() {
        val papi: (String) -> String? = { _ -> "vip" }
        assertTrue(toLeafBoolean(evalLeaf("%rank% == \"vip\"", emptyMap(), papi)))
        assertFalse(toLeafBoolean(evalLeaf("%rank% == \"admin\"", emptyMap(), papi)))
    }

    @Test
    fun `unresolved papi is null then falsy`() {
        val papi: (String) -> String? = { _ -> null }
        assertFalse(toLeafBoolean(evalLeaf("%missing%", emptyMap(), papi)))
        // null == "" → true
        assertTrue(toLeafBoolean(evalLeaf("%missing% == \"\"", emptyMap(), papi)))
    }

    @Test
    fun `no papi provider yields an empty placeholder`() {
        // "" and not null: the TS engine is authoritative on coercion (ADR
        // `expression-parity`), and its Scope returns "" with no resolver. The
        // boolean outcome — what a condition actually reads — is false either way.
        assertEquals("", evalLeaf("%anything%", emptyMap(), null))
        assertFalse(toLeafBoolean(evalLeaf("%anything%", emptyMap(), null)))
    }

    @Test
    fun `unparseable expression returns null`() {
        assertNull(evalLeaf("balance >< 5", emptyMap()))
        assertNull(evalLeaf("(unclosed", emptyMap()))
    }

    @Test
    fun `parenthesised sub-expression`() {
        assertEquals(true, evalLeaf("(1 + 2) == 3", emptyMap()))
    }
}
