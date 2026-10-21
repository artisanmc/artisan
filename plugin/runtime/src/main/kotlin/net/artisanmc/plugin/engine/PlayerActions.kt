package net.artisanmc.plugin.engine

import net.artisanmc.plugin.command.ModuleCommandLine
import net.artisanmc.plugin.platform.ServerPlatform
import net.artisanmc.plugin.text.LenientText
import net.kyori.adventure.title.Title
import java.time.Duration
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.Sound
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import net.artisanmc.plugin.platform.Chat
import net.artisanmc.plugin.platform.ItemTexts

/**
 * Game logic of the core actions on the player: commands, items, economy, xp,
 * messages, sound, teleport, title. Bound to their declarations by
 * [CoreActionHandlers].
 */
internal object PlayerActions {

    fun runCommand(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val player = ctx.player
        val cmd = rt.text(ctx, args, "command").trimStart('/')
        val asConsole = Args.str(args, "as") == "console"
        val bridged = if (!asConsole) tryRegistryDispatch(cmd, player, rt.executor) else false
        if (!bridged) {
            if (asConsole) rt.executor.scheduler.onGlobal { Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd) }
            else player.performCommand(cmd)
        }
        return ctx
    }

    /**
     * Bridge (modules.md §4.2): a "namespace:name args…" known to the CommandRegistry is
     * dispatched to the module (args = {"argv": tokens, "raw": raw string}) instead of
     * Bukkit. Unknown ref → Bukkit fallback (a Bukkit command may legitimately be named
     * "plugin:label").
     */
    private fun tryRegistryDispatch(cmd: String, player: Player, ex: ActionExecutor): Boolean {
        val registry = ex.commandRegistry ?: return false
        val line = ModuleCommandLine.parse(cmd, registry.names()) ?: return false
        runCatching { registry.dispatch(line.ref, player, mapOf("argv" to line.argv, "raw" to line.raw)) }
            .onFailure { Bukkit.getLogger().warning("[Artisan] command '${line.ref}' failed: ${it.message}") }
        return true
    }

    fun giveItem(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val material = Material.matchMaterial(Args.str(args, "material") ?: return ctx) ?: return ctx
        val item = ItemStack(material, Args.int(args, "count", 1))
        val name = args["name"]
        val lore = Args.ltextList(args, "lore")
        if (name != null || lore.isNotEmpty()) {
            val meta = item.itemMeta
            if (name != null) ItemTexts.setName(meta, LenientText.parse(rt.text(ctx, args, "name")))
            if (lore.isNotEmpty()) ItemTexts.setLore(meta, lore.map { LenientText.parse(rt.executor.resolveText(it, ctx)) })
            item.itemMeta = meta
        }
        val overflow = ctx.player.inventory.addItem(item).values
        if (overflow.isNotEmpty()) {
            // A full inventory must not eat a reward: the rest falls at the player's feet.
            overflow.forEach { ctx.player.world.dropItemNaturally(ctx.player.location, it) }
            rt.executor.lang?.let { Chat.send(ctx.player, it.get("action.inventory_full", ctx.player)) }
        }
        return ctx
    }

    fun takeItem(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val material = Material.matchMaterial(Args.str(args, "material") ?: return ctx) ?: return ctx
        var toRemove = Args.int(args, "count", 1)
        val inventory = ctx.player.inventory
        inventory.contents.orEmpty().forEachIndexed { i, item ->
            if (item != null && item.type == material && toRemove > 0) {
                val take = minOf(toRemove, item.amount)
                toRemove -= take
                if (item.amount - take <= 0) inventory.setItem(i, null)
                else item.amount -= take
            }
        }
        return ctx
    }

    fun giveMoney(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        rt.executor.deps.vault?.deposit(ctx.player, Args.double(args, "amount", 0.0))
        return ctx
    }

    fun takeMoney(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        rt.executor.deps.vault?.withdraw(ctx.player, Args.double(args, "amount", 0.0))
        return ctx
    }

    fun giveXp(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        ctx.player.giveExp(Args.int(args, "amount", 0))
        return ctx
    }

    fun giveLevel(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        ctx.player.giveExpLevels(Args.int(args, "amount", 0))
        return ctx
    }

    fun sendMessage(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        Chat.send(ctx.player, LenientText.parse(rt.text(ctx, args, "text")))
        return ctx
    }

    fun broadcast(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        Chat.broadcast(LenientText.parse(rt.text(ctx, args, "text")))
        return ctx
    }

    fun playSound(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val sound = Args.str(args, "sound") ?: return ctx
        runCatching {
            ctx.player.playSound(
                ctx.player.location, Sound.valueOf(sound.uppercase()),
                Args.float(args, "volume", 1f), Args.float(args, "pitch", 1f),
            )
        }
        return ctx
    }

    fun teleport(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val world = Args.str(args, "world")?.let { Bukkit.getWorld(it) } ?: return ctx
        ServerPlatform.teleport(ctx.player, org.bukkit.Location(
            world,
            Args.double(args, "x", 0.0), Args.double(args, "y", 0.0), Args.double(args, "z", 0.0),
            Args.float(args, "yaw", 0f), Args.float(args, "pitch", 0f),
        ))
        return ctx
    }

    fun showTitle(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val titleComponent = LenientText.parse(rt.text(ctx, args, "title"))
        val subtitleComponent =
            if (args["subtitle"] != null) LenientText.parse(rt.text(ctx, args, "subtitle"))
            else net.kyori.adventure.text.Component.empty()
        val times = Title.Times.times(
            Duration.ofMillis(Args.int(args, "fade_in", 10) * 50L),  // 1 tick = 50ms
            Duration.ofMillis(Args.int(args, "stay", 70) * 50L),
            Duration.ofMillis(Args.int(args, "fade_out", 20) * 50L),
        )
        Chat.title(ctx.player, Title.title(titleComponent, subtitleComponent, times))
        return ctx
    }
}
