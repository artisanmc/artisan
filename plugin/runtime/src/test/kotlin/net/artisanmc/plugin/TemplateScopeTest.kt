package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.exprValue
import net.artisanmc.plugin.engine.render
import org.bukkit.entity.Player
import kotlin.test.*

/**
 * The runtime seam between Bukkit values and the Expression engine — replaces the
 * old `ArgResolverTest` now that `ArgResolver` is gone (ADR `expression-parity` §5).
 *
 * The engine itself is covered by the cross-stack vector; what is specific here is
 * that a live `Player` or `World` behaves like the plain map the editor binds.
 */
class TemplateScopeTest {
    private lateinit var server: ServerMock
    private lateinit var player: Player

    @BeforeTest fun setup() {
        server = MockBukkit.mock()
        player = server.addPlayer("Steve")
    }

    @AfterTest fun teardown() = MockBukkit.unmock()

    private fun ctx(args: Map<String, Any> = emptyMap()) = ExecutionContext(player, args)

    @Test fun `flat arg`() {
        assertEquals("Hello Steve", ctx(mapOf("name" to "Steve")).render("Hello {name}"))
    }

    @Test fun `dotted field on a row map`() {
        val args = mapOf("shop" to mapOf("material" to "DIAMOND", "price" to 100))
        assertEquals("DIAMOND x100", ctx(args).render("{shop.material} x{shop.price}"))
    }

    @Test fun `numbers render without a trailing decimal`() {
        assertEquals("price 42", ctx(mapOf("n" to 42)).render("price {n}"))
    }

    @Test fun `a bare player renders its name, not its toString`() {
        assertEquals("Hi Steve", ctx(mapOf("target" to player)).render("Hi {target}"))
    }

    @Test fun `player fields`() {
        val args = mapOf("target" to player)
        assertEquals("Steve", ctx(args).render("{target.name}"))
        assertEquals(player.uniqueId.toString(), ctx(args).render("{target.uuid}"))
        assertEquals(player.world.name, ctx(args).render("{target.world}"))
    }

    @Test fun `a bare world renders its name`() {
        assertEquals("in ${player.world.name}", ctx(mapOf("w" to player.world)).render("in {w}"))
    }

    /** `player` is an implicit built-in of every context. */
    @Test fun `the viewer is always in scope`() {
        assertEquals("Steve", ctx().render("{player.name}"))
    }

    @Test fun `an unbound root keeps its source visible`() {
        assertEquals("{nope} here", ctx().render("{nope} here"))
    }

    @Test fun `a bound root with a missing field renders empty`() {
        assertEquals("", ctx(mapOf("shop" to mapOf("a" to 1))).render("{shop.alpha}"))
    }

    @Test fun `i18n and papi tokens are left alone without providers`() {
        assertEquals(
            "{i18n:menus.x} %player_name%",
            ctx(mapOf("name" to "Steve")).render("{i18n:menus.x} %player_name%"),
        )
    }

    /** The value API stays typed — that is what makes `context: { cat: "{cat}" }` work. */
    @Test fun `exprValue hands back the raw row, not its rendering`() {
        val row = mapOf("id" to "weapons", "items" to listOf(1, 2))
        assertEquals(row, ctx(mapOf("cat" to row)).exprValue("cat"))
        assertEquals(listOf(1, 2), ctx(mapOf("cat" to row)).exprValue("cat.items"))
    }

    @Test fun `the list methods reach the runtime`() {
        val args = mapOf("rewards" to listOf(mapOf("name" to "+150 XP"), mapOf("name" to "+500\$")))
        assertEquals("+150 XP\n+500\$", ctx(args).render("{rewards.pluck(\"name\").join(\"\\n\")}"))
    }

    @Test fun `a ternary picks a material`() {
        assertEquals("GRAY_DYE", ctx(mapOf("q" to mapOf("can_start" to false)))
            .render("{q.can_start ? \"EMERALD\" : \"GRAY_DYE\"}"))
    }
}
