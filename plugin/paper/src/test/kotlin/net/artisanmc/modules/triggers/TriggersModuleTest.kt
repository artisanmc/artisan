package net.artisanmc.modules.triggers

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ModuleRegistry
import net.artisanmc.modules.api.action.ActionContext
import net.artisanmc.modules.api.action.ActionRuntime
import net.artisanmc.modules.api.action.ModuleActionsApi
import net.artisanmc.modules.api.command.CommandRegistry
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.event.ModuleEventBus
import net.artisanmc.modules.api.project.ProjectContentApi
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.ArtisanPlugin
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.Listener
import org.bukkit.event.block.BlockBreakEvent
import org.bukkit.event.player.PlayerJoinEvent
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** End to end, without the engine: a Bukkit event fires, the Trigger's chain changes it. */
class TriggersModuleTest {
    private lateinit var server: ServerMock
    private lateinit var plugin: ArtisanPlugin
    private lateinit var api: ArtisanAPI
    private val module = TriggersModule()
    private val docs = mutableListOf<Map<String, Any?>>()
    private val ran = mutableListOf<String>()

    /** Runs each step's handler from the registry, the way the engine dispatches by name. */
    private val actions = object : ModuleActionsApi {
        override fun execute(player: Player, actions: String, args: Map<String, Any>, projectId: String?) {}
        override fun run(player: Player, chain: Any?, args: Map<String, Any>, projectId: String?) {
            val ctx = Ctx(player, args)
            for (step in chain as List<*>) {
                val (name, value) = when (step) {
                    is String -> step to null
                    is Map<*, *> -> step.entries.single().let { it.key.toString() to it.value }
                    else -> error("step $step")
                }
                ran += name
                val decl = api.actionRegistry.find(name) ?: continue
                decl.handler.execute(ctx, decl.bind(value), Runtime)
            }
        }
    }

    private class Ctx(private val player: Player, private val args: Map<String, Any>) : ActionContext {
        override fun getPlayer() = player
        override fun getArgs() = args
        override fun getLang() = "en"
        override fun getProjectId(): String? = "demo"
        override fun withArgs(args: Map<String, Any>): ActionContext = Ctx(player, this.args + args)
    }

    private object Runtime : ActionRuntime {
        override fun text(ctx: ActionContext, text: Any?) = text.toString().replace("{player}", ctx.player.name)
        // A text "translated" per reader: Alex reads French, the others and the console English.
        override fun textFor(ctx: ActionContext, text: Any?, viewer: Player?): String {
            val raw = (text as? Map<*, *>)?.let { it[if (viewer?.name == "Alex") "fr" else "en"] } ?: text
            return text(ctx, raw)
        }
        override fun run(ctx: ActionContext, chain: Any?) = ctx
        override fun warn(message: String) {}
    }

    @BeforeEach fun setup() {
        server = MockBukkit.mock()
        plugin = MockBukkit.load(ArtisanPlugin::class.java)
        val reg = ModuleRegistry()
        api = ArtisanAPI.builder(
            plugin, DataSourceRegistry(), CommandRegistry(), ModuleEventBus(), SchemaRegistry(), reg, "1.0.0",
            object : ProjectContentApi {
                override fun projectIds() = listOf("demo")
                override fun list(projectId: String, dir: String) = emptyList<String>()
                override fun read(projectId: String, relPath: String): String? = null
                override fun hasContent(dir: String) = false
                override fun documents(projectId: String, kind: String): List<Map<String, Any>> =
                    @Suppress("UNCHECKED_CAST") (if (kind == "trigger") docs as List<Map<String, Any>> else emptyList())
            },
        )
            .actions(actions)
            .text(net.artisanmc.plugin.text.ArtisanText)
            .build()
        reg.bind(api) {}
        module.onEnable(api)
    }

    @AfterEach fun teardown() {
        module.onDisable()
        MockBukkit.unmock()
    }

    @Test
    fun `declares its kind, its actions and the catalog`() {
        assertTrue(api.documentKinds.has("trigger"))
        assertEquals("triggers", api.documentKinds.find("trigger")?.dir)
        assertTrue(api.actionRegistry.has("cancel_event"))
        assertTrue(api.actionRegistry.has("set_event"))
        assertTrue(api.gameEvents.has("player_death"))
    }

    @Test
    fun `set_event rewrites the join message`() {
        docs += mapOf(
            "id" to "welcome", "on" to "player_join",
            "do" to listOf(mapOf("set_event" to mapOf("join_message" to mapOf("en" to "Hello {player}", "fr" to "Salut {player}")))),
        )
        module.onReload()
        val alex = server.addPlayer("Alex")
        val player = server.addPlayer("Steve")
        // addPlayer fired their own joins: only the one below is read.
        while (alex.nextMessage() != null) Unit
        while (player.nextMessage() != null) Unit
        val event = PlayerJoinEvent(player, "Steve joined the game")
        server.pluginManager.callEvent(event)
        // The single vanilla message is replaced by one per reader, in their language.
        @Suppress("DEPRECATION")
        assertEquals(null, event.joinMessage)
        assertEquals("Hello Steve", player.nextMessage())
        assertEquals("Salut Steve", alex.nextMessage())
    }

    @Test
    fun `cancel_event cancels a block break`() {
        docs += mapOf("id" to "no_break", "on" to "block_break", "do" to listOf("cancel_event"))
        module.onReload()
        val player = server.addPlayer()
        val block = server.addSimpleWorld("w").getBlockAt(0, 64, 0).apply { type = Material.STONE }
        val event = BlockBreakEvent(block, player)
        server.pluginManager.callEvent(event)
        assertTrue(event.isCancelled)
        assertEquals(listOf("cancel_event"), ran)
    }

    @Test
    fun `an event a protection already cancelled runs no trigger`() {
        docs += mapOf("id" to "no_break", "on" to "block_break", "do" to listOf("cancel_event"))
        module.onReload()
        server.pluginManager.registerEvents(object : Listener {
            @EventHandler(priority = EventPriority.LOW) fun on(e: BlockBreakEvent) { e.isCancelled = true }
        }, plugin)
        val block = server.addSimpleWorld("w").getBlockAt(0, 64, 0).apply { type = Material.STONE }
        server.pluginManager.callEvent(BlockBreakEvent(block, server.addPlayer()))
        assertEquals(emptyList<String>(), ran)
    }

    @Test
    fun `no trigger for an event means nothing runs`() {
        module.onReload()
        val event = PlayerJoinEvent(server.addPlayer(), "joined")
        server.pluginManager.callEvent(event)
        @Suppress("DEPRECATION")
        assertEquals("joined", event.joinMessage)
        assertFalse(api.gameEvents.isObserved("player_join"))
    }
}
