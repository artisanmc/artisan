package net.artisanmc.plugin.render

import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.format.Style
import net.kyori.adventure.text.format.TextDecoration
import net.kyori.adventure.text.minimessage.MiniMessage
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
        // Fallback chain: requested lang → any lang declared in the pack → empty.
        // The pack's manifest may declare only a subset of MC client locales; without
        // this fallback, players whose `sender.locale().language` is not in the manifest
        // would see raw i18n keys instead of any translation at all.
        val langMap = menu.langMaps[lang] ?: menu.langMaps.values.firstOrNull() ?: emptyMap()
        // Per-title placeholder interpolation: `{argName}` from the ExecutionContext
        // args, then `%papi%` via PlaceholderAPI. Same chain as resolveText() applies
        // to item title/lore.
        val papi = evaluator.deps.papi
        val interpolate: (String) -> String = { raw ->
            var text = raw
            ctx.args.forEach { (k, v) -> text = text.replace("{$k}", v.toString()) }
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
        val inv = Bukkit.createInventory(ArtisanMenuHolder(), menu.yaml.size, title)
        val activeClicks = mutableMapOf<Int, Map<ClickType, ClickHandler>>()

        for (layer in menu.yaml.layers) {
            for (element in layer.elements) {
                val compiledList = menu.compiledAppearances[element.id] ?: emptyList()
                val chosen = compiledList.firstOrNull { ca ->
                    evaluator.evaluateAll(ca.conditions, ctx)
                } ?: continue

                val item = buildItem(chosen.yaml, langMap, ctx, evaluator.deps)
                val slots = parsePositions(element.positions, menu.yaml.size)
                for (slot in slots) {
                    inv.setItem(slot, item)
                    if (chosen.clicks.isNotEmpty()) activeClicks[slot] = chosen.clicks
                }
            }
        }

        player.openInventory(inv)
        return MenuSession(menu.id, ctx.copy(lang = lang, langMap = langMap), activeClicks)
    }

    private fun buildItem(
        app: AppearanceYaml,
        langMap: Map<String, String>,
        ctx: ExecutionContext,
        deps: SoftDepRegistry,
    ): ItemStack {
        val papi = deps.papi
        val count = app.count.coerceAtLeast(1)
        val item = app.material?.let { mat ->
            deps.buildCustomStack(mat, count)
                ?: runCatching { Material.valueOf(mat.uppercase()) }.getOrNull()
                    ?.let { ItemStack(it, count) }
        } ?: ItemStack(Material.STONE, count)
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
        ctx.args.forEach { (k, v) -> text = text.replace("{$k}", v.toString()) }
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
