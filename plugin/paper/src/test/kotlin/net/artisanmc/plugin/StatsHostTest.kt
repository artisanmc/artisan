package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.plugin.command.CompiledCommand
import net.artisanmc.plugin.command.PackCommand
import net.artisanmc.plugin.config.StatsConfig
import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ClickHandler
import net.artisanmc.plugin.engine.ConditionEvaluator
import net.artisanmc.plugin.engine.CooldownStore
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.engine.MenuProvider
import net.artisanmc.plugin.engine.MenuSessionStore
import net.artisanmc.plugin.engine.RuntimeMenu
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.lang.LangManager
import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.entity.Player
import java.time.ZoneId
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

class StatsHostTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val plugin by lazy { MockBukkit.load(ArtisanPlugin::class.java) }

    @Test
    fun `api stats is the recorder, with Artisan's own events declared`() {
        assertSame(plugin.stats.recorder, plugin.api.stats)
        assertEquals(
            listOf("core:command", "core:first_join", "core:menu_click", "core:menu_open", "core:players_online", "core:session"),
            plugin.stats.recorder.declared().map { it.name },
        )
        assertTrue(plugin.api.stats.isEnabled)
    }

    @Test
    fun `a session is recorded when the player leaves, with its duration`() {
        val server = MockBukkit.getMock()!!
        plugin.stats.recorder.buffer.drain()
        val player = server.addPlayer()
        player.disconnect()
        val raws = plugin.stats.recorder.buffer.drain().raws.filter { it.event == CoreStats.SESSION }
        assertEquals(listOf(player.uniqueId.toString()), raws.map { it.player })
        assertTrue(raws.single().value >= 0.0)
        assertTrue(raws.single().details.contains("started_at"))
    }

    @Test
    fun `a command counts by sub-command and result`() {
        val seen = mutableListOf<String>()
        val deps = SoftDepRegistry.EMPTY
        val cooldowns = CooldownStore()
        val provider = object : MenuProvider {
            override fun load() {}
            override fun findMenu(menuId: String): RuntimeMenu? = null
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        }
        val executor = ActionExecutor(plugin, provider, MenuSessionStore(), deps, cooldowns, ConditionEvaluator(deps, cooldowns))
        val handler = ClickHandler(emptyList(), emptyList())
        val child = CompiledCommand("buy", emptyList(), "shop.buy", null, emptyList(), handler)
        val root = CompiledCommand("shop", emptyList(), null, null, emptyList(), handler, children = listOf(child))
        val command = PackCommand(root, executor, LangManager(emptyMap(), "en", false), ran = { _, name, sub, result -> seen += "$name|$sub|$result" })
        val player = MockBukkit.getMock()!!.addPlayer()
        // A group only shows its usage: nothing ran, nothing is counted.
        command.execute(player, "shop", emptyArray())
        command.execute(player, "shop", arrayOf("buy"))
        player.addAttachment(plugin, "shop.buy", true)
        command.execute(player, "shop", arrayOf("buy"))
        assertEquals(listOf("shop|buy|permission", "shop|buy|ok"), seen)
    }

    @Test
    fun `record_event counts the admin's own event for the player`() {
        plugin.stats.recorder.buffer.drain()
        val player = MockBukkit.getMock()!!.addPlayer()
        val steps = listOf(
            net.artisanmc.plugin.engine.Step.ActionStep("record_event", "tutorial_done"),
            net.artisanmc.plugin.engine.Step.ActionStep("record_event", mapOf("event" to "tutorial_step", "dimensions" to mapOf("step" to "{n}"), "value" to 3)),
        )
        plugin.runtime.executor.execute(steps, ExecutionContext(player, args = mapOf("n" to "2")))
        val buckets = plugin.stats.recorder.buffer.drain().buckets.associate { it.event to (it.dims to it.sum) }
        assertEquals(mapOf("custom:tutorial_done" to ("" to 1.0), "custom:tutorial_step" to ("step=2" to 3.0)), buckets)
    }

    @Test
    fun `the stats section is read with its defaults and bounds`() {
        val defaults = StatsConfig.from(YamlConfiguration())
        assertEquals(StatsConfig(), defaults)
        val cfg = YamlConfiguration().apply {
            loadFromString(
                """
                stats:
                  enabled: false
                  flush-seconds: 1
                  retention: { hourly-days: 30, daily-days: 400, raw-days: 14 }
                  timezone: "Europe/Paris"
                  disabled-events: ["core:menu_click"]
                """.trimIndent(),
            )
        }
        val read = StatsConfig.from(cfg)
        assertEquals(false, read.settings.enabled)
        assertEquals(setOf("core:menu_click"), read.settings.disabledEvents)
        assertEquals(5, read.flushSeconds)
        assertEquals(net.artisanmc.plugin.stats.StatsRetention(30, 400, 14), read.retention)
        assertEquals(ZoneId.of("Europe/Paris"), read.zone)
    }
}
