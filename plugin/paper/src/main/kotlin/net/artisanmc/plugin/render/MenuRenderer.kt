package net.artisanmc.plugin.render

import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.MenuTitleLayer
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.resourcepack.AssetEntry
import net.kyori.adventure.text.format.Style
import net.kyori.adventure.text.format.NamedTextColor
import net.kyori.adventure.text.format.TextDecoration
import net.kyori.adventure.text.minimessage.MiniMessage
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.NamespacedKey
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
    /** Placeholder rendering the base item's lore where it is written. */
    private const val BASE_LORE = "{base.lore}"

    private val itemMapper = ObjectMapper().registerKotlinModule()

    private val noItalic = Style.style(TextDecoration.ITALIC.withState(false))

    private val INVENTORY_TYPES: Map<String, InventoryType> = mapOf(
        "hopper" to InventoryType.HOPPER,
        "dropper" to InventoryType.DROPPER,
    )

    private fun parse(text: String) = LenientText.parse(text).applyFallbackStyle(noItalic)

    /**
     * Source list of an iteration / a placement: a flat args key (classic sourceRef) OR a
     * dotted path into a context object (`category.items`, an object passed whole through
     * `context: { category: "{cat}" }`).
     */
    private fun sourceList(args: Map<String, Any>, source: String): List<*> =
        (args[source] ?: exprListValue(source, args)) as? List<*> ?: emptyList<Any>()

    /**
     * Dotted path into a context object, evaluated as an Expression. Deliberately
     * value-level, not text: the iteration needs the List itself, not its rendering.
     */
    private fun exprListValue(source: String, args: Map<String, Any>): Any? =
        runCatching {
            net.artisanmc.plugin.expr.evaluateExpr(
                net.artisanmc.plugin.expr.parseExpr(source),
                net.artisanmc.plugin.expr.ExprScope(args),
            )
        }.getOrNull()

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
        windows: MenuWindows? = null,
    ): MenuSession {
        // Deterministic fallback chain: requested lang → project defaultLang → empty.
        val langMap = menu.langMapWithFallback(lang)

        // Declared defaults (the caller wins by name) + ConnectorBinding fetches:
        // `pack:` (the bundle's Project sources, ltext resolved here in the viewer's
        // language) then the DataSourceRegistry curried on the player. See
        // ProjectDataResolver for why Project sources stay out of the registry.
        val fetch: ((String, Map<String, Any?>) -> Any?)? =
            if (dataSources == null && projectData == null) null
            else { ref, params ->
                if (projectData != null && projectData.canResolve(ref)) projectData.resolve(ref, lang, menu.projectId)
                else dataSources?.fetch(ref, player, params)
            }
        val boundArgs = ContextBinder.bind(menu.yaml, ctx.args, fetch, Bukkit.getLogger())

        // Direct-ref sugar: `iterates.source` / `places.source` may name a data
        // source ref (`ns:id` / `pack:id`) directly instead of a declared input.
        // Resolve each distinct unresolved ref once and expose the list under
        // its own key; a dangling ref simply yields nothing (non-hermetic).
        val directArgs: Map<String, Any> =
            if (fetch == null) emptyMap()
            else menu.yaml.allElements
                .flatMap { listOfNotNull(it.iterates?.source, it.places?.source) }
                .filter { it.contains(':') && it !in boundArgs }
                .distinct()
                .mapNotNull { ref ->
                    (runCatching { fetch(ref, emptyMap()) }.getOrNull() as? List<*>)
                        ?.let { ref to it as Any }
                }
                .toMap()
        val fetchedArgs = menu.yaml.contextInputs.mapNotNull { input ->
            val value = boundArgs[input.name]
            if (input.name !in ctx.args && input.source["ref"] is String &&
                (value is List<*> || value is Map<*, *>)) input.name to value else null
        }.toMap()
        val boundCtx = ctx.copy(
            args = boundArgs + directArgs,
            sourceArgs = ctx.sourceArgs + fetchedArgs + directArgs,
        )

        // Content addressed by rawSlot: in `hidden` mode, positions
        // `size until size + 36` are the window's player slots.
        val invType = INVENTORY_TYPES[menu.yaml.inventoryType]
        val content = MenuSlots(invType?.defaultSize ?: menu.yaml.size, PlayerInventoryMode.parse(menu.yaml.playerInventory))
        val slotLimit = content.slotLimit

        // Pagination window of each iterating element.
        val pageInfo = mutableMapOf<String, PageInfo>()
        for (element in menu.yaml.allElements) {
            val iter = element.iterates
            val places = element.places
            val pageCount = when {
                iter != null -> {
                    val slots = parsePositions(element.positionsSpec, slotLimit)
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
        val renderCtx = boundCtx.copy(pageInfo = pageInfo, lang = lang, defaultLang = menu.defaultLang, loreMaxWidth = menu.loreMaxWidth)

        // A menu title is a Template like any other player-facing string — the
        // renderer resolves `{…}` and `%papi%` in one pass (ADR `expression-parity` §5).
        val papi = evaluator.deps.papi
        val interpolate: (String) -> String = { raw -> renderCtx.render(raw, papi) { k -> langMap[k] } }
        val imageElements = menu.yaml.allElements.filter { el -> (listOf(el.display) + el.states).any { it.image != null } }
        val imageChoices = imageElements.associate { el -> el.id to
            menu.compiledAppearances[el.id]?.firstOrNull { evaluator.evaluateAll(it.conditions, renderCtx) } }
        val imageLayouts = imageElements.associate { it.id to ImageButtonLayout.of(menu.yaml, it) }
        val imageLayers = imageElements.mapNotNull { el ->
            val image = imageChoices[el.id]?.yaml?.image ?: return@mapNotNull null
            val layout = imageLayouts[el.id] ?: return@mapNotNull null
            if (image.asset.isBlank() || image.fit !in listOf("contain", "stretch", "native")) return@mapNotNull null
            val key = layout.assetKey(image)
            if (lookupAsset(key) == null) return@mapNotNull null
            MenuTitleLayer.Glyph(assetId = key, x = layout.x, y = layout.y)
        }
        val title = TitleCompiler.compileTitle(
            layers = menu.title + imageLayers,
            lang = lang,
            langMap = langMap,
            lookupAsset = lookupAsset,
            offsetEncoder = offsetEncoder,
            interpolate = interpolate,
            defaultLang = menu.defaultLang,
        )
        // MockBukkit does not implement createInventory's Component overload: legacy
        // fallback only in that case (production keeps the Component, required for
        // pixel-perfect font titles).
        // Branches on inventory_type: hopper/dropper create a container of the right
        // TYPE (a dropper has 9 slots like a 1-row chest but a distinct type), so size
        // alone is not enough. Chest keeps the size-based createInventory.
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
        for (element in menu.yaml.allElements) {
            val compiledList = menu.compiledAppearances[element.id] ?: emptyList()
            val slots = parsePositions(element.positionsSpec, slotLimit)
            if (element.id in imageChoices) {
                val chosen = imageChoices[element.id] ?: continue
                val layout = imageLayouts[element.id] ?: continue
                val image = chosen.yaml.image
                if (image != null && imageLayers.none { it.assetId == layout.assetKey(image) }) continue
                val item = if (image == null) buildItem(chosen.yaml, langMap, renderCtx, evaluator.deps, chosen.i18nBase)
                    else buildImageHitItem(chosen.yaml, langMap, renderCtx, evaluator.deps, chosen.i18nBase)
                for (slot in layout.slots) {
                    content[slot] = item
                    if (chosen.clicks.isNotEmpty()) activeClicks[slot] = chosen.clicks
                }
                continue
            }

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
                    if (placement.position !in 0 until slotLimit) continue
                    val row = byKey[placement.key] ?: continue
                    val itemArgs = mapOf(places.alias to row)
                    val itemCtx = renderCtx.copy(args = renderCtx.args + itemArgs)
                    val chosen = compiledList.firstOrNull { evaluator.evaluateAll(it.conditions, itemCtx) }
                        ?: continue
                    content[placement.position] = buildItem(chosen.yaml, langMap, itemCtx, evaluator.deps, chosen.i18nBase)
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
                val item = buildItem(chosen.yaml, langMap, renderCtx, evaluator.deps, chosen.i18nBase)
                for (slot in slots) {
                    content[slot] = item
                    if (chosen.clicks.isNotEmpty()) activeClicks[slot] = chosen.clicks
                }
                continue
            }
            // Iterating element: one list entry per slot, windowed by page.
            val list = sourceList(renderCtx.args, iter.source)
            val info = renderCtx.pageInfo[element.id] ?: PageInfo(0, 1)
            val window = list.drop(info.page * slots.size).take(slots.size)
            window.forEachIndexed { i, entry ->
                val slot = slots[i]
                val itemArgs = mapOf(iter.alias to (entry ?: ""))
                val itemCtx = renderCtx.copy(args = renderCtx.args + itemArgs)
                val chosen = compiledList.firstOrNull { evaluator.evaluateAll(it.conditions, itemCtx) }
                    ?: return@forEachIndexed
                content[slot] = buildItem(chosen.yaml, langMap, itemCtx, evaluator.deps, chosen.i18nBase)
                if (chosen.clicks.isNotEmpty()) {
                    activeClicks[slot] = chosen.clicks
                    slotArgs[slot] = itemArgs
                }
            }
        }

        // Empty anchor: the content goes out as packets. Registered before opening,
        // whose packets must already be rewritten; released if another plugin
        // cancelled the open (otherwise its next window would be captured).
        windows?.open(player, inv, content, menu.yaml.vanillaTexture)
        player.openInventory(inv)
        if (player.openInventory.topInventory !== inv) windows?.release(player, inv)
        return MenuSession(menu.id, renderCtx.copy(lang = lang, langMap = langMap), activeClicks, slotArgs, content, menu.escapeGoesBack)
    }

    private fun buildImageHitItem(app: AppearanceYaml, langMap: Map<String, String>, ctx: ExecutionContext,
                                  deps: SoftDepRegistry, i18nBase: String): ItemStack {
        val item = buildItem(AppearanceYaml(material = "PAPER", title = app.title, lore = app.lore), langMap, ctx, deps, i18nBase)
        val meta = item.itemMeta
        try {
            meta.setItemModel(NamespacedKey("artisan", "buttons/hit_area"))
        } catch (_: NoSuchMethodError) {
            // MockBukkit's older API has no item_model; empty slots still route clicks.
            return ItemStack(Material.AIR)
        }
        meta.setHideTooltip(app.title == null && app.lore.isEmpty())
        item.itemMeta = meta
        return item
    }

    private fun buildItem(
        app: AppearanceYaml,
        langMap: Map<String, String>,
        ctx: ExecutionContext,
        deps: SoftDepRegistry,
        i18nBase: String = "",
        depth: Int = 0,
    ): ItemStack {
        if (depth > 32) {
            Bukkit.getLogger().warning("Artisan: circular item inheritance (maximum depth 32)")
            return ItemStack(Material.BARRIER).apply { editMeta { it.displayName(parse("Circular item inheritance")) } }
        }
        val papi = deps.papi
        val source = app.extends ?: app.item ?: app.material
        val rawMaterial = (source as? String)?.trim()
        val value = if (rawMaterial != null && rawMaterial.startsWith("{") && rawMaterial.endsWith("}")) {
            exprListValue(rawMaterial.substring(1, rawMaterial.length - 1), ctx.resolvedArgs)
        } else source as? Map<*, *>
        val base = (value as? Map<*, *>)?.let {
            val fields = it.entries.associate { entry -> entry.key.toString() to entry.value }.toMutableMap()
            if (fields["lore"] is String) fields["lore"] = listOf(fields["lore"])
            val extension = fields.remove("extends")
            itemMapper.convertValue(fields, AppearanceYaml::class.java).copy(extends = extension)
        }
        val count = (app.count ?: base?.count ?: 1).coerceIn(1, 64)
        // The material may be a placeholder ({input} or {alias.field}), resolved
        // through the context before the vanilla/custom lookup.
        val resolvedMaterial = rawMaterial?.let { ctx.render(it, papi) }
        var item = base?.let { buildItem(it, langMap, ctx, deps, depth = depth + 1) }
            ?: (value as? String)?.let { buildItem(AppearanceYaml(item = it), langMap, ctx, deps, depth = depth + 1) }
            ?: resolvedMaterial?.let { mat ->
            deps.buildCustomStack(mat, count)
                ?: runCatching { Material.valueOf(mat.uppercase()) }.getOrNull()
                    ?.let { ItemStack(it, count) }
        } ?: ItemStack(Material.STONE, count)
        val inheritedMeta = item.itemMeta
        val baseValues = mapOf<String, Any>(
            "material" to item.type.name, "count" to item.amount,
            "title" to (inheritedMeta?.displayName()?.let { MiniMessage.miniMessage().serialize(it) } ?: ""),
            "lore" to (inheritedMeta?.lore()?.joinToString("\n") { MiniMessage.miniMessage().serialize(it) } ?: ""),
        )
        val localCtx = ctx.copy(args = ctx.args + ("base" to baseValues))
        if (app.count != null) item.amount = count
        val head = app.head
        if (item.type == Material.PLAYER_HEAD && head != null) {
            item = HeadApplier.apply(item, resolveText(head, langMap, localCtx, papi), deps)
        }
        val meta: ItemMeta = item.itemMeta ?: return item
        if (app.title != null) {
            val lt = app.title!!
            val value = lt.forLang(localCtx.lang, localCtx.defaultLang)
            if (value != null) {
                // A field-local map is authoritative (ADR field-local-translations); a
                // bare literal keeps the legacy address lookup for non-default langs.
                val address = if (lt.isMap) null else addressOf(i18nBase, "title")
                meta.displayName(parse(resolveText(value, langMap, localCtx, papi, address)))
            }
        }
        if (app.lore.isNotEmpty() || app.loreMode == "replace") {
            val loreAddress = addressOf(i18nBase, "lore")
            val alias = Regex("^\\{(\\w+)\\.icon}$").matchEntire((app.item ?: app.material).orEmpty())?.groupValues?.get(1)
            val row = alias?.let { ctx.resolvedArgs[it] as? Map<*, *> }
            val icon = row?.get("icon") as? Map<*, *>
            val legacyToken = if (icon?.containsKey("extends") == true && icon.containsKey("lore") &&
                (row?.get("lore") == null || row["lore"] == "" || row["lore"] == emptyList<Any>())) "{$alias.lore}" else null
            val rawLines = app.lore.mapNotNull { lt ->
                val value = lt.forLang(localCtx.lang, localCtx.defaultLang) ?: return@mapNotNull null
                when {
                    lt.isMap -> value
                    value.startsWith("{i18n:") -> langMap[value.removePrefix("{i18n:").removeSuffix("}")] ?: value
                    else -> loreAddress?.let { langMap[it] } ?: value
                }
            }
            val legacy = legacyToken != null && rawLines.any { it.contains(legacyToken) }
            val tokened = rawLines.map { if (legacy) it.replace(legacyToken!!, BASE_LORE) else it }
            // The base lore stays by default: it goes away only with `lore_mode: replace`
            // or when `{base.lore}` places it itself (otherwise it would show twice).
            val replacement = tokened.any { it.contains(BASE_LORE) } || app.loreMode == "replace"
            val base = if (replacement) emptyList() else meta.lore() ?: emptyList()
            val lines = tokened.flatMap { raw -> localCtx.render(raw, papi) { key -> langMap[key] }.split("\n") }
                .flatMap { LoreWrap.wrap(LenientText.legacyToMini(it), localCtx.loreMaxWidth) }
            meta.lore(if (lines == listOf("")) base else base + lines.map { parse(it).colorIfAbsent(NamedTextColor.WHITE) })
        }
        ItemDetails.applyToMeta(app, meta)
        item.itemMeta = meta
        // Raw NBT goes last: it may hand back a different stack.
        return ItemDetails.applyNbt(app, item)
    }

    private fun addressOf(base: String, leaf: String): String? =
        if (base.isEmpty()) null else "$base.$leaf"

    /**
     * Explicit `{i18n:key}` ref wins; otherwise the literal is looked up at its
     * canonical ADDRESS (inline mode — the literal is the default language, the
     * other languages sit at `address` in `lang/<lang>.yaml`); otherwise the
     * literal stands as written.
     */
    private fun resolveText(
        raw: String,
        langMap: Map<String, String>,
        ctx: ExecutionContext,
        papi: PapiProvider?,
        address: String? = null,
    ): String {
        var text = if (raw.startsWith("{i18n:")) {
            langMap[raw.removePrefix("{i18n:").removeSuffix("}")] ?: raw
        } else {
            address?.let { langMap[it] } ?: raw
        }
        // The lang map also backs the presentation keys (`artisan.duration.*`), so a
        // duration reads in the viewer's language like any other string.
        return ctx.render(text, papi) { key -> langMap[key] }
    }

    private fun parsePositions(positions: String, size: Int): List<Int> =
        BundleCompiler.parsePositions(positions, size)
}
