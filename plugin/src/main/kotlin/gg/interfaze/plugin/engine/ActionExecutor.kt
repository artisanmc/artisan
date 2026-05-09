package gg.interfaze.plugin.engine

import gg.interfaze.plugin.provider.MenuProvider
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.Sound
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import org.bukkit.plugin.java.JavaPlugin

class ActionExecutor(
    private val plugin: JavaPlugin,
    private val menuProvider: MenuProvider,
    private val sessions: MenuSessionStore,
    private val deps: SoftDepRegistry,
    private val cooldowns: CooldownStore,
    private val evaluator: ConditionEvaluator,
) {
    private val mm = MiniMessage.miniMessage()

    fun handle(handler: ClickHandler, ctx: ExecutionContext) {
        val cooldown = handler.cooldown
        if (cooldown != null && cooldowns.isOnCooldown(cooldown.id, ctx.player.uniqueId, cooldown.scope)) {
            cooldown.message?.let { ctx.player.sendMessage(mm.deserialize(it)) }
            return
        }
        if (!evaluator.evaluateAll(handler.requirements, ctx)) {
            execute(handler.fallback, ctx)
            return
        }
        execute(handler.actions, ctx)
        if (cooldown != null) {
            cooldowns.set(cooldown.id, ctx.player.uniqueId, cooldown.scope, cooldown.durationSeconds)
        }
    }

    fun execute(actions: List<Action>, ctx: ExecutionContext) {
        actions.forEach { executeOne(it, ctx) }
    }

    fun resolveArgs(text: String, ctx: ExecutionContext): String {
        var result = text
        ctx.args.forEach { (k, v) -> result = result.replace("{$k}", v.toString()) }
        return result
    }

    fun resolveText(text: String, ctx: ExecutionContext): String {
        var resolved = if (text.startsWith("{i18n:")) {
            val key = text.removePrefix("{i18n:").removeSuffix("}")
            ctx.langMap[key] ?: text
        } else text
        resolved = resolveArgs(resolved, ctx)
        deps.papi?.let { resolved = it.resolve(ctx.player, resolved) }
        return resolved
    }

    private fun executeOne(action: Action, ctx: ExecutionContext) {
        val player = ctx.player
        when (action) {
            is Action.RunCommand -> {
                val cmd = resolveText(action.command, ctx).trimStart('/')
                if (action.asConsole) Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd)
                else player.performCommand(cmd)
            }
            is Action.OpenMenu -> {
                val newArgs = if (action.clearContext) {
                    action.context.mapValues { it.value as Any }
                } else {
                    ctx.args + action.context.mapValues { it.value as Any }
                }
                menuProvider.openMenu(player, action.menuId, ctx.lang, ctx.copy(args = newArgs))
            }
            is Action.CloseMenu -> player.closeInventory()
            is Action.OpenDialog -> {
                val newArgs = if (action.clearContext)
                    action.context.mapValues { it.value as Any }
                else
                    ctx.args + action.context.mapValues { it.value as Any }
                menuProvider.openDialog(player, action.dialogId, ctx.lang, ctx.copy(args = newArgs))
            }
            is Action.CloseDialog -> runCatching { player.javaClass.getMethod("closeDialog").invoke(player) }
            is Action.GiveItem  -> {
                val material = Material.matchMaterial(action.material) ?: return
                val item = ItemStack(material, action.count)
                if (action.name != null || action.lore.isNotEmpty()) {
                    val meta = item.itemMeta
                    if (action.name != null) meta.displayName(mm.deserialize(resolveText(action.name, ctx)))
                    if (action.lore.isNotEmpty()) meta.lore(action.lore.map { mm.deserialize(resolveText(it, ctx)) })
                    item.itemMeta = meta
                }
                player.inventory.addItem(item)
            }
            is Action.TakeItem -> {
                val material = Material.matchMaterial(action.material) ?: return
                var toRemove = action.count
                player.inventory.contents.orEmpty().forEachIndexed { i, item ->
                    if (item != null && item.type == material && toRemove > 0) {
                        val take = minOf(toRemove, item.amount)
                        toRemove -= take
                        if (item.amount - take <= 0) player.inventory.setItem(i, null)
                        else item.amount -= take
                    }
                }
            }
            is Action.GiveMoney -> deps.vault?.deposit(player, action.amount)
            is Action.TakeMoney -> deps.vault?.withdraw(player, action.amount)
            is Action.GiveXp    -> player.giveExp(action.amount)
            is Action.GiveLevel -> player.giveExpLevels(action.amount)
            is Action.SendMessage  -> player.sendMessage(mm.deserialize(resolveText(action.text, ctx)))
            is Action.Broadcast    -> Bukkit.getServer().broadcast(mm.deserialize(resolveText(action.text, ctx)))
            is Action.PlaySound    -> runCatching {
                player.playSound(player.location, Sound.valueOf(action.sound.uppercase()), action.volume, action.pitch)
            }
            is Action.Teleport -> {
                if (action.warpName != null && action.world == null) return
                val world = action.world?.let { Bukkit.getWorld(it) } ?: return
                player.teleport(org.bukkit.Location(world, action.x, action.y, action.z, action.yaw, action.pitch))
            }
            is Action.PaginationNext, is Action.PaginationPrev -> Unit
        }
    }
}
