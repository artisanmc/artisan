package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.provider.MenuProvider
import net.artisanmc.plugin.render.MenuRenderer
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.Material
import org.bukkit.entity.Player
import kotlin.test.*

class MenuRendererIterationTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    /** 3 slots (10-12), liste de 5 items → page 0 = 3 premiers, page 1 = 2 derniers. */
    private fun gridMenu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: shop
        title: []
        size: 27
        context_inputs:
          - { name: shops, type: list }
        layers:
          - id: main
            name: Main
            elements:
              - id: grid
                positions: "10-12"
                iterates: { source: shops, alias: shop }
                appearances:
                  - material: "{shop.material}"
                    title: "{shop.name}"
                    click:
                      left:
                        steps: 'run_command "buy {shop.id}" as player'
        """.trimIndent(),
    )

    private fun shops(n: Int): List<Map<String, Any>> = (1..n).map {
        mapOf("id" to "s$it", "name" to "Shop $it", "material" to if (it % 2 == 0) "DIAMOND" else "EMERALD")
    }

    @Test fun `renders one item per list entry within the element slots`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p, args = mapOf("shops" to shops(2))))
        val inv = p.openInventory.topInventory
        assertEquals(Material.EMERALD, inv.getItem(10)?.type)  // s1
        assertEquals(Material.DIAMOND, inv.getItem(11)?.type)  // s2
        assertNull(inv.getItem(12))                            // pas de 3e item
        assertEquals("shop", session.menuId)
    }

    @Test fun `windowing — page 1 shows the remainder and pageInfo is exposed`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(
            p, menu, "en",
            ExecutionContext(p, args = mapOf("shops" to shops(5)), pagination = mapOf("grid" to 1)),
        )
        val inv = p.openInventory.topInventory
        assertNotNull(inv.getItem(10)) // s4
        assertNotNull(inv.getItem(11)) // s5
        assertNull(inv.getItem(12))
        assertEquals(PageInfo(page = 1, pageCount = 2), session.ctx.pageInfo["grid"])
    }

    @Test fun `requested page beyond the end is clamped`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(
            p, menu, "en",
            ExecutionContext(p, args = mapOf("shops" to shops(5)), pagination = mapOf("grid" to 99)),
        )
        assertEquals(1, session.ctx.pageInfo["grid"]?.page)
    }

    @Test fun `slotArgs carry the per-item alias for click execution`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p, args = mapOf("shops" to shops(2))))
        @Suppress("UNCHECKED_CAST")
        val item0 = session.slotArgs[10]?.get("shop") as? Map<String, Any>
        assertEquals("s1", item0?.get("id"))
        assertTrue(session.activeClicks.containsKey(10))
    }

    @Test fun `empty or missing list renders nothing and yields one empty page`() {
        val p = player()
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        assertNull(p.openInventory.topInventory.getItem(10))
        assertEquals(PageInfo(0, 1), session.ctx.pageInfo["grid"])
    }

    @Test fun `full loop — pagination_next re-renders the next window`() {
        val p = player()
        val pluginInstance = MockBukkit.load(ArtisanPlugin::class.java)
        val menu = BundleCompiler.compile(gridMenu(), emptyMap())
        val sessions = MenuSessionStore()
        val provider = object : MenuProvider {
            override fun load() {}
            override fun findMenu(menuId: String) = menu
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
                sessions.set(player, MenuRenderer.open(player, menu, lang, ctx))
            }
            override fun allBundles(): List<ProjectBundle> = emptyList()
        }
        val executor = ActionExecutor(pluginInstance, provider, sessions, SoftDepRegistry.EMPTY, CooldownStore(), ConditionEvaluator.EMPTY)

        provider.openMenu(p, "shop", "en", ExecutionContext(p, args = mapOf("shops" to shops(5))))
        val before = sessions.get(p)!!
        assertEquals(0, before.ctx.pageInfo["grid"]?.page)

        executor.execute(listOf(Action.PaginationNext("grid")), before.ctx)

        val after = sessions.get(p)!!
        assertEquals(1, after.ctx.pageInfo["grid"]?.page)
        assertNull(p.openInventory.topInventory.getItem(12)) // page 1 n'a que 2 items
    }

    @Test fun `declared default fills an arg used by a non-iterating element`() {
        val p = player()
        val yaml: MenuYaml = mapper.readValue(
            """
            schema: menu/v1
            id: m
            title: []
            size: 9
            context_inputs:
              - { name: label, type: string, default: Hi }
            layers:
              - id: l
                name: L
                elements:
                  - id: btn
                    positions: "0"
                    appearances:
                      - material: STONE
                        title: "{label}"
            """.trimIndent(),
        )
        val menu = BundleCompiler.compile(yaml, emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        assertEquals("Hi", session.ctx.args["label"])
    }

    @Test fun `builtin player placeholder resolves in an element title`() {
        val p = MockBukkit.getMock()!!.addPlayer("Steve")
        val yaml: MenuYaml = mapper.readValue(
            """
            schema: menu/v1
            id: m
            title: []
            size: 9
            layers:
              - id: l
                name: L
                elements:
                  - id: btn
                    positions: "0"
                    appearances:
                      - material: STONE
                        title: "Hello {player.name}"
            """.trimIndent(),
        )
        val menu = BundleCompiler.compile(yaml, emptyMap())
        MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        val display = p.openInventory.topInventory.getItem(0)?.itemMeta?.displayName()
        assertNotNull(display)
        assertEquals("Hello Steve", PlainTextComponentSerializer.plainText().serialize(display))
    }
}
