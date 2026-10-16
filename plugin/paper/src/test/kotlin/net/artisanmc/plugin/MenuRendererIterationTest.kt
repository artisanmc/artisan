package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.engine.RuntimeProject
import net.artisanmc.plugin.engine.MenuProvider
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

    /** 3 slots (10-12), list of 5 items → page 0 = first 3, page 1 = last 2. */
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
                material: "{shop.material}"
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
        val menu = MenuCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p, args = mapOf("shops" to shops(2))))
        val inv = session.slots
        assertEquals(Material.EMERALD, inv[10]?.type)  // s1
        assertEquals(Material.DIAMOND, inv[11]?.type)  // s2
        assertNull(inv[12])                            // no 3rd item
        assertEquals("shop", session.menuId)
    }

    @Test fun `windowing — page 1 shows the remainder and pageInfo is exposed`() {
        val p = player()
        val menu = MenuCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(
            p, menu, "en",
            ExecutionContext(p, args = mapOf("shops" to shops(5)), pagination = mapOf("grid" to 1)),
        )
        val inv = session.slots
        assertNotNull(inv[10]) // s4
        assertNotNull(inv[11]) // s5
        assertNull(inv[12])
        assertEquals(PageInfo(page = 1, pageCount = 2), session.ctx.pageInfo["grid"])
    }

    @Test fun `requested page beyond the end is clamped`() {
        val p = player()
        val menu = MenuCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(
            p, menu, "en",
            ExecutionContext(p, args = mapOf("shops" to shops(5)), pagination = mapOf("grid" to 99)),
        )
        assertEquals(1, session.ctx.pageInfo["grid"]?.page)
    }

    @Test fun `slotArgs carry the per-item alias for click execution`() {
        val p = player()
        val menu = MenuCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p, args = mapOf("shops" to shops(2))))
        @Suppress("UNCHECKED_CAST")
        val item0 = session.slotArgs[10]?.get("shop") as? Map<String, Any>
        assertEquals("s1", item0?.get("id"))
        assertTrue(session.activeClicks.containsKey(10))
    }

    @Test fun `returning to shop main then clicking another category refreshes its items`() {
        val p = player()
        val pluginInstance = MockBukkit.load(ArtisanPlugin::class.java)
        val sources = net.artisanmc.modules.api.datasource.DataSourceRegistry()
        val categories = listOf(
            mapOf("id" to "keys", "name" to "Keys", "icon" to "TRIPWIRE_HOOK"),
            mapOf("id" to "tools", "name" to "Tools", "icon" to "DIAMOND_PICKAXE"),
        )
        sources.register(net.artisanmc.modules.api.datasource.DataSourceDeclaration("boutique:categories", { _, _ -> categories }))
        sources.register(net.artisanmc.modules.api.datasource.DataSourceDeclaration("boutique:items", { _, _ ->
            categories.map { mapOf("id" to it.getValue("id"), "category" to it.getValue("id"),
                "name" to it.getValue("name"), "icon" to it.getValue("icon"), "final_price" to 10) }
        }))
        val menus = mapOf(
            "shop_main" to """
                schema: menu/v1
                id: shop_main
                title: []
                size: 54
                inputs:
                  - { name: cats, type: list, source: { ref: 'boutique:categories' } }
                elements:
                  - id: grid
                    positions: '10-43'
                    iterates: { source: cats, alias: cat }
                    material: '{cat.icon}'
                    title: '{cat.name}'
                    click:
                      left: 'open_menu shop_category with category="{cat.id}" category_name="{cat.name}"'
            """,
            "shop_category" to """
                schema: menu/v1
                id: shop_category
                title: []
                size: 54
                inputs:
                  - { name: category, type: string }
                  - { name: category_name, type: string, default: '' }
                  - name: items
                    type: list
                    source: { ref: 'boutique:items', filter: { category: '{category}' } }
                elements:
                  - id: grid
                    positions: '10-43'
                    iterates: { source: items, alias: item }
                    material: '{item.icon}'
                    title: '{item.name}'
                  - id: back
                    positions: '49'
                    material: ARROW
                    click:
                      left: 'open_menu shop_main'
            """,
        ).mapValues { (_, raw) ->
            val yaml: MenuYaml = mapper.readValue(raw.trimIndent())
            MenuCompiler.compile(yaml, emptyMap())
        }
        val sessions = MenuSessionStore()
        val provider = object : MenuProvider {
            override fun load() {}
            override fun findMenu(menuId: String) = menus[menuId]
            override fun runtimeProjects(): List<RuntimeProject> = emptyList()
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
                sessions.set(player, MenuRenderer.open(player, menus.getValue(menuId), lang, ctx, dataSources = sources))
            }
        }
        val executor = ActionExecutor(pluginInstance, provider, sessions, SoftDepRegistry.EMPTY, CooldownStore(), ConditionEvaluator.EMPTY)
        val listener = net.artisanmc.plugin.render.MenuListener(pluginInstance, sessions, executor)
        fun click(slot: Int) {
            listener.onClick(org.bukkit.event.inventory.InventoryClickEvent(
                p.openInventory, org.bukkit.event.inventory.InventoryType.SlotType.CONTAINER, slot,
                org.bukkit.event.inventory.ClickType.LEFT, org.bukkit.event.inventory.InventoryAction.PICKUP_ALL,
            ))
            MockBukkit.getMock()!!.scheduler.performOneTick()
        }

        provider.openMenu(p, "shop_main", "en", ExecutionContext(p))
        val mainInventory = p.openInventory.topInventory
        listener.onClick(org.bukkit.event.inventory.InventoryClickEvent(
            p.openInventory, org.bukkit.event.inventory.InventoryType.SlotType.CONTAINER, 10,
            org.bukkit.event.inventory.ClickType.LEFT, org.bukkit.event.inventory.InventoryAction.PICKUP_ALL,
        ))
        // Bukkit forbids openInventory inside InventoryClickEvent: the client then
        // misses the slots whose item is unchanged between the two menus.
        assertSame(mainInventory, p.openInventory.topInventory)
        MockBukkit.getMock()!!.scheduler.performOneTick()
        assertEquals("keys", sessions.get(p)!!.ctx.args["category"])
        assertEquals(Material.TRIPWIRE_HOOK, sessions.get(p)!!.slots[10]?.type)
        click(49)
        click(11)
        assertEquals("tools", sessions.get(p)!!.ctx.args["category"])
        assertEquals(Material.DIAMOND_PICKAXE, sessions.get(p)!!.slots[10]?.type)
    }

    @Test fun `empty or missing list renders nothing and yields one empty page`() {
        val p = player()
        val menu = MenuCompiler.compile(gridMenu(), emptyMap())
        val session = MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        assertNull(session.slots[10])
        assertEquals(PageInfo(0, 1), session.ctx.pageInfo["grid"])
    }

    @Test fun `full loop — pagination_next re-renders the next window`() {
        val p = player()
        val pluginInstance = MockBukkit.load(ArtisanPlugin::class.java)
        val menu = MenuCompiler.compile(gridMenu(), emptyMap())
        val sessions = MenuSessionStore()
        val provider = object : MenuProvider {
            override fun load() {}
            override fun findMenu(menuId: String) = menu
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {
                sessions.set(player, MenuRenderer.open(player, menu, lang, ctx))
            }
            override fun runtimeProjects(): List<RuntimeProject> = emptyList()
        }
        val executor = ActionExecutor(pluginInstance, provider, sessions, SoftDepRegistry.EMPTY, CooldownStore(), ConditionEvaluator.EMPTY)

        provider.openMenu(p, "shop", "en", ExecutionContext(p, args = mapOf("shops" to shops(5))))
        val before = sessions.get(p)!!
        assertEquals(0, before.ctx.pageInfo["grid"]?.page)

        executor.execute(listOf(Step.ActionStep("pagination_next", "grid")), before.ctx)

        val after = sessions.get(p)!!
        assertEquals(1, after.ctx.pageInfo["grid"]?.page)
        assertNull(after.slots[12]) // page 1 n'a que 2 items
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
                    material: STONE
                    title: "{label}"
            """.trimIndent(),
        )
        val menu = MenuCompiler.compile(yaml, emptyMap())
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
                    material: STONE
                    title: "Hello {player.name}"
            """.trimIndent(),
        )
        val menu = MenuCompiler.compile(yaml, emptyMap())
        val slots = MenuRenderer.open(p, menu, "en", ExecutionContext(p)).slots
        val display = slots[0]?.itemMeta?.displayName()
        assertNotNull(display)
        assertEquals("Hello Steve", PlainTextComponentSerializer.plainText().serialize(display))
    }
}
