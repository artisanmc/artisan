package net.artisanmc.plugin.render

import net.artisanmc.modules.api.DataSourceRegistry
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
import org.bukkit.event.inventory.InventoryType
import org.bukkit.inventory.Inventory
import org.bukkit.inventory.InventoryHolder
import org.bukkit.inventory.ItemStack
import org.bukkit.inventory.meta.ItemMeta

class ArtisanMenuHolder : InventoryHolder {
    override fun getInventory(): Inventory = error("not used")
}

object MenuRenderer {

    private val noItalic = Style.style(TextDecoration.ITALIC.withState(false))

    private val INVENTORY_TYPES: Map<String, InventoryType> = mapOf(
        "hopper" to InventoryType.HOPPER,
        "dropper" to InventoryType.DROPPER,
    )

    private fun parse(text: String) = LenientText.parse(text).applyFallbackStyle(noItalic)

    /**
     * Liste source d'une itération / d'un placement : clé plate des args
     * (sourceRef classique) OU chemin pointé dans un objet de contexte
     * (`category.items` — objet passé entier via `context: { category: "{cat}" }`).
     */
    private fun sourceList(args: Map<String, Any>, source: String): List<*> =
        (args[source] ?: ArgResolver.lookupValue(source, args)) as? List<*> ?: emptyList<Any>()

    fun open(
        player: Player,
        menu: BundleMenu,
        lang: String,
        ctx: ExecutionContext = ExecutionContext(player),
        evaluator: ConditionEvaluator = ConditionEvaluator.EMPTY,
        lookupAsset: (String) -> AssetEntry? = { null },
        offsetEncoder: OffsetEncoder = OffsetEncoder.EMPTY,
        dataSources: DataSourceRegistry? = null,
        projectData: ProjectDataResolver? = null,
    ): MenuSession {
        // Deterministic fallback chain: requested lang → pack defaultLang → empty.
        // Previously fell back to `langMaps.values.firstOrNull()` which is map-
        // iteration-order dependent (non-deterministic across loads).
        val langMap = menu.langMapWithFallback(lang)

        // §15.4 : defaults déclarés (l'appelant gagne par nom) + fetch des
        // ConnectorBinding — `pack:` (Project sources du bundle, ltext résolus
        // ici avec la langue du viewer) puis DataSourceRegistry curryfié sur le
        // player. Cf. ProjectDataResolver pour le pourquoi du non-registry.
        val fetch: ((String, Map<String, Any?>) -> Any?)? =
            if (dataSources == null && projectData == null) null
            else { ref, params ->
                if (projectData != null && projectData.canResolve(ref)) projectData.resolve(ref, lang)
                else dataSources?.fetch(ref, player, params)
            }
        val boundCtx = ctx.copy(args = ContextBinder.bind(menu.yaml, ctx.args, fetch, Bukkit.getLogger()))

        // Pré-calcul des fenêtres de pagination de chaque élément itérant.
        val pageInfo = mutableMapOf<String, PageInfo>()
        for (layer in menu.yaml.layers) for (element in layer.elements) {
            val iter = element.iterates
            val places = element.places
            val pageCount = when {
                iter != null -> {
                    val slots = parsePositions(element.positions, menu.yaml.size)
                    val list = sourceList(boundCtx.args, iter.source)
                    val pageSize = slots.size.coerceAtLeast(1)
                    ((list.size + pageSize - 1) / pageSize).coerceAtLeast(1)
                }
                // Placement mode: pages are hand-assigned, so the count is the
                // highest referenced page (+1), not derived from the row count.
                places != null -> (places.placements.maxOfOrNull { it.page + 1 } ?: 1).coerceAtLeast(1)
                else -> continue
            }
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
        // Branche sur inventory_type : hopper/dropper créent un container du bon
        // TYPE (un dropper a 9 slots comme un chest 1-row mais un type distinct),
        // donc on ne peut pas se reposer sur size. Chest garde le createInventory
        // basé sur size.
        val invType = INVENTORY_TYPES[menu.yaml.inventoryType]
        val inv = if (invType != null) {
            runCatching { Bukkit.createInventory(ArtisanMenuHolder(), invType, title) }
                .getOrElse {
                    Bukkit.createInventory(
                        ArtisanMenuHolder(), invType,
                        LegacyComponentSerializer.legacySection().serialize(title),
                    )
                }
        } else {
            runCatching { Bukkit.createInventory(ArtisanMenuHolder(), menu.yaml.size, title) }
                .getOrElse {
                    Bukkit.createInventory(
                        ArtisanMenuHolder(), menu.yaml.size,
                        LegacyComponentSerializer.legacySection().serialize(title),
                    )
                }
        }
        val activeClicks = mutableMapOf<Int, Map<ClickType, ClickHandler>>()
        val slotArgs = mutableMapOf<Int, Map<String, Any>>()

        for (layer in menu.yaml.layers) {
            for (element in layer.elements) {
                val compiledList = menu.compiledAppearances[element.id] ?: emptyList()
                val slots = parsePositions(element.positions, menu.yaml.size)

                // Placement mode: pin explicit rows (matched by key_field) to
                // hand-authored page+slot. Rows not placed are omitted; a placement
                // whose key is absent from the source (removed while offline) dangles
                // and its slot is simply left empty.
                val places = element.places
                if (places != null) {
                    val list = sourceList(renderCtx.args, places.source)
                    val byKey = list.filterIsInstance<Map<*, *>>()
                        .associateBy { it[places.keyField]?.toString() }
                    val info = renderCtx.pageInfo[element.id] ?: PageInfo(0, 1)
                    for (placement in places.placements) {
                        if (placement.page != info.page) continue
                        if (placement.position !in 0 until menu.yaml.size) continue
                        val row = byKey[placement.key] ?: continue
                        val itemArgs = mapOf(places.alias to row)
                        val itemCtx = renderCtx.copy(args = renderCtx.args + itemArgs)
                        val chosen = compiledList.firstOrNull { evaluator.evaluateAll(it.conditions, itemCtx) }
                            ?: continue
                        val appYaml = applyOverride(chosen.yaml, placement.override)
                        inv.setItem(placement.position, buildItem(appYaml, langMap, itemCtx, evaluator.deps))
                        if (chosen.clicks.isNotEmpty()) {
                            activeClicks[placement.position] = chosen.clicks
                            slotArgs[placement.position] = itemArgs
                        }
                    }
                    continue
                }

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
                val list = sourceList(renderCtx.args, iter.source)
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

    /** Merge a Placement's display-only override onto the template appearance. */
    private fun applyOverride(base: AppearanceYaml, override: net.artisanmc.plugin.model.PlacementOverrideYaml?): AppearanceYaml {
        if (override == null) return base
        return base.copy(
            material = override.material ?: base.material,
            head = override.head ?: base.head,
            count = override.count ?: base.count,
            title = override.title ?: base.title,
            lore = override.lore ?: base.lore,
        )
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
