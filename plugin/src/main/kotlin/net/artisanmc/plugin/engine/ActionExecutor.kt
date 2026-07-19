package net.artisanmc.plugin.engine

import net.artisanmc.modules.api.CommandRegistry
import net.artisanmc.plugin.provider.MenuProvider
import net.artisanmc.plugin.render.LenientText
import net.kyori.adventure.text.minimessage.MiniMessage
import net.kyori.adventure.title.Title
import java.time.Duration
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
    private val commandRegistry: CommandRegistry? = null,
) {

    fun handle(handler: ClickHandler, ctx: ExecutionContext) {
        val cooldown = handler.cooldown
        if (cooldown != null && cooldowns.isOnCooldown(cooldown.id, ctx.player.uniqueId, cooldown.scope)) {
            cooldown.message?.let { ctx.player.sendMessage(LenientText.parse(it)) }
            return
        }
        if (!evaluator.evaluateAll(handler.requirements, ctx)) {
            execute(handler.fallback, ctx)
            return
        }
        if (handler.steps.isNotEmpty()) executeSteps(handler.steps, ctx)
        else execute(handler.actions, ctx)
        if (cooldown != null) {
            cooldowns.set(cooldown.id, ctx.player.uniqueId, cooldown.scope, cooldown.durationSeconds)
        }
    }

    fun execute(actions: List<Action>, ctx: ExecutionContext) {
        actions.fold(ctx) { cur, action -> executeOne(action, cur) }
    }

    /**
     * Exécute un arbre canonique : actions plates + branches if/else-if/else.
     * Le contexte est replié d'action en action pour que `set_arg*` soit
     * visible par les actions suivantes du même clic.
     */
    fun executeSteps(steps: List<Step>, ctx: ExecutionContext): ExecutionContext {
        var cur = ctx
        for (step in steps) cur = when (step) {
            is Step.ActionStep -> executeOne(step.action, cur)
            is Step.IfStep -> {
                val case = step.cases.firstOrNull { caseMatches(it, cur) }
                executeSteps(case?.steps ?: step.elseSteps, cur)
            }
        }
        return cur
    }

    /** `joins` est évalué de gauche à droite sans précédence ; manquant = "and". */
    private fun caseMatches(case: IfCase, ctx: ExecutionContext): Boolean {
        if (case.conditions.isEmpty()) return true
        var result = evaluator.evaluate(case.conditions[0], ctx)
        for (i in 1 until case.conditions.size) {
            val next = evaluator.evaluate(case.conditions[i], ctx)
            result = if (case.joins.getOrNull(i - 1) == "or") result || next else result && next
        }
        return result
    }

    fun resolveArgs(text: String, ctx: ExecutionContext): String =
        ArgResolver.resolve(text, ctx.resolvedArgs)

    fun resolveText(text: String, ctx: ExecutionContext): String {
        var resolved = if (text.startsWith("{i18n:")) {
            val key = text.removePrefix("{i18n:").removeSuffix("}")
            ctx.langMap[key] ?: text
        } else text
        resolved = resolveArgs(resolved, ctx)
        deps.papi?.let { resolved = it.resolve(ctx.player, resolved) }
        return resolved
    }

    /** Exécute une action et retourne le contexte — mis à jour par `set_arg*` pour les actions suivantes. */
    private fun executeOne(action: Action, ctx: ExecutionContext): ExecutionContext {
        val player = ctx.player
        when (action) {
            is Action.RunCommand -> {
                val cmd = resolveText(action.command, ctx).trimStart('/')
                val bridged = if (!action.asConsole) tryRegistryDispatch(cmd, player) else false
                if (!bridged) {
                    if (action.asConsole) Bukkit.dispatchCommand(Bukkit.getConsoleSender(), cmd)
                    else player.performCommand(cmd)
                }
            }
            is Action.OpenMenu -> {
                // Context values interpolate against the EMITTING ctx (the click
                // that binds the iteration row / current args) — the target menu
                // only ever sees flat, already-resolved values.
                val passed = action.context.mapValues { resolveText(it.value, ctx) as Any }
                val newArgs = if (action.clearContext) passed else ctx.args + passed
                // La pagination est un état par menu — ne jamais la propager au menu
                // cible (collision d'element ids entre menus, ex. deux "grid").
                menuProvider.openMenu(
                    player, action.menuId, ctx.lang,
                    ctx.copy(args = newArgs, pagination = emptyMap(), pageInfo = emptyMap()),
                )
            }
            is Action.CloseMenu -> player.closeInventory()
            is Action.OpenDialog -> {
                // Same rule as OpenMenu: {item.*}-style context values resolve at
                // emit time — the dialog's texts/actions read the flat args only.
                val passed = action.context.mapValues { resolveText(it.value, ctx) as Any }
                val newArgs = if (action.clearContext) passed else ctx.args + passed
                menuProvider.openDialog(player, action.dialogId, ctx.lang, ctx.copy(args = newArgs))
            }
            is Action.CloseDialog -> runCatching { player.javaClass.getMethod("closeDialog").invoke(player) }
            is Action.GiveItem  -> {
                val material = Material.matchMaterial(action.material) ?: return ctx
                val item = ItemStack(material, action.count)
                if (action.name != null || action.lore.isNotEmpty()) {
                    val meta = item.itemMeta
                    if (action.name != null) meta.displayName(LenientText.parse(resolveText(action.name, ctx)))
                    if (action.lore.isNotEmpty()) meta.lore(action.lore.map { LenientText.parse(resolveText(it, ctx)) })
                    item.itemMeta = meta
                }
                player.inventory.addItem(item)
            }
            is Action.TakeItem -> {
                val material = Material.matchMaterial(action.material) ?: return ctx
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
            is Action.SendMessage  -> player.sendMessage(LenientText.parse(resolveText(action.text, ctx)))
            is Action.Broadcast    -> Bukkit.getServer().broadcast(LenientText.parse(resolveText(action.text, ctx)))
            is Action.PlaySound    -> runCatching {
                player.playSound(player.location, Sound.valueOf(action.sound.uppercase()), action.volume, action.pitch)
            }
            is Action.Teleport -> {
                val world = action.world?.let { Bukkit.getWorld(it) } ?: return ctx
                player.teleport(org.bukkit.Location(world, action.x, action.y, action.z, action.yaw, action.pitch))
            }
            is Action.PaginationNext -> return paginate(ctx, action.elementId, +1)
            is Action.PaginationPrev -> return paginate(ctx, action.elementId, -1)
            is Action.SetArg -> return applyArg(ctx, action.arg, resolveText(action.value, ctx))
            is Action.SetArgCycleNext -> return cycleArg(ctx, action.arg, action.list, forward = true)
            is Action.SetArgCyclePrev -> return cycleArg(ctx, action.arg, action.list, forward = false)
            is Action.ShowTitle -> {
                val titleComponent    = LenientText.parse(resolveText(action.title, ctx))
                val subtitleComponent = action.subtitle?.let { LenientText.parse(resolveText(it, ctx)) }
                                            ?: net.kyori.adventure.text.Component.empty()
                val times = Title.Times.times(
                    Duration.ofMillis(action.fadeIn  * 50L),  // 1 tick = 50ms
                    Duration.ofMillis(action.stay    * 50L),
                    Duration.ofMillis(action.fadeOut * 50L),
                )
                player.showTitle(Title.title(titleComponent, subtitleComponent, times))
            }
        }
        return ctx
    }

    /**
     * Pont modules.md §4.2 : "namespace:name args…" connu du CommandRegistry est
     * dispatché au module (args = {"argv": tokens, "raw": chaîne brute}) au lieu
     * de Bukkit. Ref inconnue → fallback Bukkit (une commande Bukkit peut
     * légitimement s'appeler "plugin:label").
     */
    private fun tryRegistryDispatch(cmd: String, player: Player): Boolean {
        val registry = commandRegistry ?: return false
        val space = cmd.indexOf(' ')
        val ref = if (space == -1) cmd else cmd.substring(0, space)
        if (!Regex("^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$").matches(ref)) return false
        if (!registry.has(ref)) return false
        val raw = if (space == -1) "" else cmd.substring(space + 1)
        val argv = if (raw.isEmpty()) emptyList() else raw.split(' ').filter { it.isNotEmpty() }
        runCatching { registry.dispatch(ref, player, mapOf("argv" to argv, "raw" to raw)) }
            .onFailure { Bukkit.getLogger().warning("[Artisan] command '$ref' failed: ${it.message}") }
        return true
    }

    /** Met à jour un arg de contexte et re-rend le menu courant du joueur (s'il y en a un). */
    private fun applyArg(ctx: ExecutionContext, arg: String, value: String): ExecutionContext {
        val newCtx = ctx.copy(args = ctx.args + (arg to value))
        sessions.get(ctx.player)?.let { session ->
            menuProvider.openMenu(ctx.player, session.menuId, newCtx.lang, newCtx)
        }
        return newCtx
    }

    private fun cycleArg(ctx: ExecutionContext, arg: String, list: String, forward: Boolean): ExecutionContext {
        val values = list.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        if (values.isEmpty()) return ctx
        val idx = values.indexOf(ctx.args[arg]?.toString())
        val next = when {
            idx < 0 -> if (forward) values.first() else values.last()
            forward -> values[(idx + 1) % values.size]
            else    -> values[(idx - 1 + values.size) % values.size]
        }
        return applyArg(ctx, arg, next)
    }

    /** Avance/recule la page des éléments ciblés (clamp aux bornes) puis re-rend le menu courant. */
    private fun paginate(ctx: ExecutionContext, elementId: String?, delta: Int): ExecutionContext {
        val session = sessions.get(ctx.player) ?: return ctx
        val targets = if (elementId != null) listOf(elementId) else ctx.pageInfo.keys.toList()
        var pagination = ctx.pagination
        for (t in targets) {
            val info = ctx.pageInfo[t] ?: continue
            val next = (info.page + delta).coerceIn(0, info.pageCount - 1)
            if (next != info.page) pagination = pagination + (t to next)
        }
        if (pagination == ctx.pagination) return ctx
        val newCtx = ctx.copy(pagination = pagination)
        menuProvider.openMenu(ctx.player, session.menuId, newCtx.lang, newCtx)
        return newCtx
    }
}
