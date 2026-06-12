package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.engine.ArgResolver
import kotlin.test.*

class ArgResolverTest {
    private lateinit var server: ServerMock
    @BeforeTest fun setup() { server = MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

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
    @Test fun `bare player value renders the player name`() {
        val p = server.addPlayer("Steve")
        assertEquals("Hi Steve", ArgResolver.resolve("Hi {target}", mapOf("target" to p)))
    }
    @Test fun `player dotted fields resolve name uuid world`() {
        val p = server.addPlayer("Steve")
        val args = mapOf<String, Any>("target" to p)
        assertEquals("Steve", ArgResolver.resolve("{target.name}", args))
        assertEquals(p.uniqueId.toString(), ArgResolver.resolve("{target.uuid}", args))
        assertEquals(p.world.name, ArgResolver.resolve("{target.world}", args))
    }
    @Test fun `unknown player field stays unresolved`() {
        val p = server.addPlayer("Steve")
        assertEquals("{target.health}", ArgResolver.resolve("{target.health}", mapOf("target" to p)))
    }
    @Test fun `bare world value renders the world name`() {
        val w = server.addSimpleWorld("nether_hub")
        assertEquals("in nether_hub", ArgResolver.resolve("in {w}", mapOf("w" to w)))
    }
}
