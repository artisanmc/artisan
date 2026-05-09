package gg.interfaze.plugin.render

import gg.interfaze.plugin.engine.*
import gg.interfaze.plugin.model.AppearanceYaml
import gg.interfaze.plugin.model.BundleMenu
import net.kyori.adventure.text.format.Style
import net.kyori.adventure.text.format.TextDecoration
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.InventoryHolder
import org.bukkit.inventory.ItemStack

class InterfazeMenuHolder : InventoryHolder {
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
    ): MenuSession {
        val langMap = menu.langMaps[lang] ?: emptyMap()
        val papi = evaluator.deps.papi
        val rawTitle = menu.resolveTitle(lang)
        val resolvedTitle = run {
            var t = rawTitle
            ctx.args.forEach { (k, v) -> t = t.replace("{$k}", v.toString()) }
            if (papi != null) t = papi.resolve(player, t)
            t
        }
        val title = mm.deserialize(resolvedTitle)
        val inv = Bukkit.createInventory(InterfazeMenuHolder(), menu.yaml.size, title)
        val activeClicks = mutableMapOf<Int, Map<ClickType, ClickHandler>>()

        for (layer in menu.yaml.layers) {
            for (element in layer.elements) {
                val compiledList = menu.compiledAppearances[element.id] ?: emptyList()
                val chosen = compiledList.firstOrNull { ca ->
                    evaluator.evaluateAll(ca.conditions, ctx)
                } ?: continue

                val item = buildItem(chosen.yaml, langMap, ctx, papi)
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
        papi: PapiProvider?,
    ): ItemStack {
        val material = app.material
            ?.let { runCatching { Material.valueOf(it.uppercase()) }.getOrNull() }
            ?: Material.STONE
        val item = ItemStack(material, app.count.coerceAtLeast(1))
        val meta = item.itemMeta ?: return item
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
