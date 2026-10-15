package net.artisanmc.plugin.engine

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.ActionDeclaration
import net.artisanmc.modules.api.ActionRegistry
import net.artisanmc.modules.api.ModelField
import net.artisanmc.modules.api.ModelFieldType
import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.provider.MenuProvider
import org.bukkit.entity.Player
import kotlin.test.*

/**
 * R1 of ADR `extensible-document-kinds`: every action runs through the registry. A module's
 * declaration is dispatched like a core one, with the wire value bound to its arguments;
 * the core vocabulary is complete (one handler per published name) and nothing else.
 */
class ActionRegistryDispatchTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val pluginInstance by lazy { MockBukkit.load(ArtisanPlugin::class.java) }
    private val deps = SoftDepRegistry.EMPTY
    private val cooldowns = CooldownStore()
    private val sessions = MenuSessionStore()
    private val evaluator = ConditionEvaluator(deps, cooldowns)
    private var lastOpenedMenuId: String? = null
    private val stubProvider = object : MenuProvider {
        override fun load() {}
        override fun findMenu(menuId: String): BundleMenu? = null
        override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) { lastOpenedMenuId = menuId }
        override fun openDialog(player: Player, dialogId: String, lang: String, ctx: ExecutionContext) {}
        override fun allBundles(): List<ProjectBundle> = emptyList()
    }

    private fun executor(registry: ActionRegistry) =
        ActionExecutor(pluginInstance, stubProvider, sessions, deps, cooldowns, evaluator, null, null, registry)

    @Test fun `the core handlers cover the core vocabulary exactly once`() {
        val registry = CoreActionHandlers.registry()
        assertEquals(CoreActions.all.map { it.name }.toSet(), registry.names())
        for (schema in CoreActions.all) {
            val decl = assertNotNull(registry.find(schema.name), schema.name)
            assertEquals(schema.args, decl.args, "${schema.name} arguments")
            assertEquals(schema.primary, decl.primary, "${schema.name} primary")
        }
    }

    @Test fun `a module action is dispatched with its bound arguments and may rebind the context`() {
        val registry = CoreActionHandlers.registry()
        var received: Map<String, Any>? = null
        var seenProject: String? = null
        registry.register(ActionDeclaration(
            "quests:start",
            listOf(
                ModelField("quest", ModelFieldType.string(), true),
                ModelField("silent", ModelFieldType.bool()).withDefault(false),
            ),
            "quest",
        ) { ctx, args, _ ->
            received = args
            seenProject = ctx.projectId
            ctx.withArgs(mapOf("started" to args["quest"]!!))
        })
        val p = MockBukkit.getMock()!!.addPlayer()
        val end = executor(registry).execute(
            listOf(Step.ActionStep("quests:start", "intro"), Step.ActionStep("open_menu", "{started}_menu")),
            ExecutionContext(p, projectId = "shop"),
        )
        assertEquals(mapOf("quest" to "intro", "silent" to false), received)
        assertEquals("shop", seenProject)
        // The rebound context flows to the next action of the chain.
        assertEquals("intro", end.args["started"])
        assertEquals("intro_menu", lastOpenedMenuId)
    }

    @Test fun `a throwing handler is skipped and the chain goes on`() {
        val registry = CoreActionHandlers.registry()
        registry.register(ActionDeclaration("quests:boom") { _, _, _ -> error("boom") })
        val p = MockBukkit.getMock()!!.addPlayer()
        executor(registry).execute(
            listOf(Step.ActionStep("quests:boom"), Step.ActionStep("give_item", "DIAMOND")),
            ExecutionContext(p),
        )
        assertTrue(p.inventory.contains(org.bukkit.Material.DIAMOND))
    }

    @Test fun `the runtime resolves module text and runs nested chains`() {
        val registry = CoreActionHandlers.registry()
        var resolved: String? = null
        registry.register(ActionDeclaration(
            "quests:notify",
            listOf(ModelField("text", ModelFieldType.ltext(), true), ModelField("then", ModelFieldType.actions())),
            "text",
        ) { ctx, args, runtime ->
            resolved = runtime.text(ctx, args["text"])
            runtime.run(ctx, args["then"])
        })
        val p = MockBukkit.getMock()!!.addPlayer()
        executor(registry).execute(
            listOf(Step.ActionStep("quests:notify", mapOf(
                "text" to mapOf("en" to "Hello {who}", "fr" to "Bonjour {who}"),
                "then" to listOf(mapOf("give_item" to "DIAMOND")),
            ))),
            ExecutionContext(p, args = mapOf("who" to "Iban"), lang = "fr"),
        )
        assertEquals("Bonjour Iban", resolved)
        assertTrue(p.inventory.contains(org.bukkit.Material.DIAMOND))
    }
}
