package net.artisanmc.plugin

import net.artisanmc.plugin.engine.ArgResolver
import kotlin.test.*

class ArgResolverTest {
    @Test fun `resolves a flat arg`() {
        assertEquals("Hello Steve", ArgResolver.resolve("Hello {name}", mapOf("name" to "Steve")))
    }
    @Test fun `resolves a dotted field on a map value`() {
        val args = mapOf("shop" to mapOf("material" to "DIAMOND", "price" to 100))
        assertEquals("DIAMOND x100", ArgResolver.resolve("{shop.material} x{shop.price}", args))
    }
    @Test fun `coerces numeric values to string`() {
        assertEquals("price 42", ArgResolver.resolve("price {n}", mapOf("n" to 42)))
    }
    @Test fun `resolves a bare alias bound to a primitive item`() {
        assertEquals("warp spawn", ArgResolver.resolve("warp {w}", mapOf("w" to "spawn")))
    }
    @Test fun `leaves unknown placeholders untouched`() {
        assertEquals("{nope} {shop.alpha}", ArgResolver.resolve("{nope} {shop.alpha}", mapOf("shop" to mapOf("a" to 1))))
    }
    @Test fun `does not touch i18n refs or papi tokens`() {
        val args = mapOf("k" to "v")
        assertEquals("{i18n:menus.x} %player_name%", ArgResolver.resolve("{i18n:menus.x} %player_name%", args))
    }
}
