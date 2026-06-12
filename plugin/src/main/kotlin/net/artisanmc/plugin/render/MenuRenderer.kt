package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.format.Style
import net.kyori.adventure.text.format.TextDecoration
import net.kyori.adventure.text.minimessage.MiniMessage
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.InventoryHolder
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.meta.ItemMeta

class ArtisanMenuHolder : InventoryHolder {
    override fun getInventory(): Inventory = error("not used")
}

object MenuRenderer {

    private val mm = MiniMessage.miniMessage()
    private val noItalic = Style.style(TextDecoration.ITALIC.withState(false))

    private fun parse(text: String) = mm.deserialize(text).applyFallbackStyle(noItalic)

    fun open(
        player: Player,
        menu: BundleMenu,
        lang: String,
        ctx: ExecutionContext = ExecutionContext(player),
        evaluator: ConditionEvaluator = ConditionEvaluator.EMPTY,
        lookupAsset: (String) -> AssetEntry? = { null },
        offsetEncoder: OffsetEncoder = OffsetEncoder.EMPTY,
    ): MenuSession {
        // Deterministic fallback chain: requested lang → pack defaultLang → empty.
        // Previously fell back to `langMaps.values.firstOrNull()` which is map-
        // iteration-order dependent (non-deterministic across loads).
        val langMap = menu.langMapWithFallback(lang)

        // §15.4 : defaults déclarés (l'appelant gagne par nom).
        val boundCtx = ctx.copy(args = ContextBinder.bind(menu.yaml, ctx.args))

        // Pré-calcul des fenêtres de pagination de chaque élément itérant.
        val pageInfo = mutableMapOf<String, PageInfo>()
        for (layer in menu.yaml.layers) for (element in layer.elements) {
            val iter = element.iterates ?: continue
            val slots = parsePositions(element.positions, menu.yaml.size)
            val list = boundCtx.args[iter.source] as? List<*> ?: emptyList<Any>()
            val pageSize = slots.size.coerceAtLeast(1)
            val pageCount = ((list.size + pageSize - 1) / pageSize).coerceAtLeast(1)
            val requested = boundCtx.pagination[element.id] ?: 0
            pageInfo[element.id] = PageInfo(requested.coerceIn(0, pageCount - 1), pageCount)
        }
        val renderCtx = boundCtx.copy(pageInfo = pageInfo)

        // Per-title placeholder interpolation: `{argName}` from the ExecutionContext
        // args, then `%papi%` via PlaceholderAPI. Same chain as resolveText() applies
        // to item title/lore.
        val papi = evaluator.deps.papi
        val interpolate: (String) -> String = { raw ->
            var text = ArgResolver.resolve(raw, renderCtx.resolvedArgs)
            if (papi != null) text = papi.resolve(player, text)
            text
        }
        val title = TitleCompiler.compileTitle(
            layers = menu.title,
            lang = lang,
            langMap = langMap,
            lookupAsset = lookupAsset,
            offsetEncoder = offsetEncoder,
            interpolate = interpolate,
        )
        // MockBukkit n'implémente pas l'overload Component de createInventory —
        // fallback legacy uniquement dans ce cas (la prod garde le Component,
        // indispensable aux titres pixel-perfect à base de fonts).
        val inv = runCatching { Bukkit.createInventory(ArtisanMenuHolder(), menu.yaml.size, title) }
            .getOrElse {
                Bukkit.createInventory(
                    ArtisanMenuHolder(), menu.yaml.size,
                    LegacyComponentSerializer.legacySection().serialize(title),
                )
            }
        val activeClicks = mutableMapOf<Int, Map<ClickType, ClickHandler>>()
        val slotArgs = mutableMapOf<Int, Map<String, Any>>()

        for (layer in menu.yaml.layers) {
            for (element in layer.elements) {
                val compiledList = menu.compiledAppearances[element.id] ?: emptyList()
                val slots = parsePositions(element.positions, menu.yaml.size)
                val iter = element.iterates
                if (iter == null) {
                    val chosen = compiledList.firstOrNull { ca ->
                        evaluator.evaluateAll(ca.conditions, renderCtx)
                    } ?: continue
                    val item = buildItem(chosen.yaml, langMap, renderCtx, evaluator.deps)
                    for (slot in slots) {
                        inv.setItem(slot, item)
                        if (chosen.clicks.isNotEmpty()) activeClicks[slot] = chosen.clicks
                    }
                    continue
                }
                // Élément itérant : une entrée de la liste par slot, fenêtrée par page.
                val list = renderCtx.args[iter.source] as? List<*> ?: emptyList<Any>()
                val info = renderCtx.pageInfo[element.id] ?: PageInfo(0, 1)
                val window = list.drop(info.page * slots.size).take(slots.size)
                window.forEachIndexed { i, entry ->
                    val slot = slots[i]
                    val itemArgs = mapOf(iter.alias to (entry ?: ""))
                    val itemCtx = renderCtx.copy(args = renderCtx.args + itemArgs)
                    val chosen = compiledList.firstOrNull { evaluator.evaluateAll(it.conditions, itemCtx) }
                        ?: return@forEachIndexed
                    inv.setItem(slot, buildItem(chosen.yaml, langMap, itemCtx, evaluator.deps))
                    if (chosen.clicks.isNotEmpty()) {
                        activeClicks[slot] = chosen.clicks
                        slotArgs[slot] = itemArgs
                    }
                }
            }
        }

        player.openInventory(inv)
        return MenuSession(menu.id, renderCtx.copy(lang = lang, langMap = langMap), activeClicks, slotArgs)
    }

    private fun buildItem(
        app: AppearanceYaml,
        langMap: Map<String, String>,
        ctx: ExecutionContext,
        deps: SoftDepRegistry,
    ): ItemStack {
        val papi = deps.papi
        val count = app.count.coerceAtLeast(1)
        // Le material peut être un placeholder ({input} ou {alias.field}) — résolu
        // via le contexte avant le lookup vanilla/custom.
        val resolvedMaterial = app.material?.let { ArgResolver.resolve(it, ctx.resolvedArgs) }
        var item = resolvedMaterial?.let { mat ->
            deps.buildCustomStack(mat, count)
                ?: runCatching { Material.valueOf(mat.uppercase()) }.getOrNull()
                    ?.let { ItemStack(it, count) }
        } ?: ItemStack(Material.STONE, count)
        if (item.type == Material.PLAYER_HEAD && app.head != null) {
            item = HeadApplier.apply(item, resolveText(app.head, langMap, ctx, papi), deps)
        }
        val meta: ItemMeta = item.itemMeta ?: return item
        if (app.title != null) meta.displayName(parse(resolveText(app.title, langMap, ctx, papi)))
        if (app.lore.isNotEmpty()) {
            meta.lore(app.lore.flatMap { raw ->
                resolveText(raw, langMap, ctx, papi).split("\n").map { parse(it) }
            })
        }
        item.itemMeta = meta
        return item
    }

    private fun resolveText(raw: String, langMap: Map<String, String>, ctx: ExecutionContext, papi: PapiProvider?): String {
        var text = if (raw.startsWith("{i18n:")) langMap[raw.removePrefix("{i18n:").removeSuffix("}")] ?: raw else raw
        text = ArgResolver.resolve(text, ctx.resolvedArgs)
        if (papi != null) text = papi.resolve(ctx.player, text)
        return text
    }

    private fun parsePositions(positions: String, size: Int): List<Int> =
        positions.split(",").flatMap { part ->
            val t = part.trim()
            if (t.contains("-")) {
                val (a, b) = t.split("-").map { it.trim().toInt() }
                (a..b).toList()
            } else {
                listOf(t.toIntOrNull() ?: return@flatMap emptyList())
            }
        }.filter { it in 0 until size }
}
