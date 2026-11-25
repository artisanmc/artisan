package net.artisanmc.plugin.pack

/** A Project text file (YAML descriptors, menus…). */
data class PackFile(val path: String, val content: String)

/** One Project as the pack reads it: its text files, its binaries by path, the module images it asks for. */
class PackProject(
    /** The id the pack anchors its assets to (`<server>.<folder>` off the hub). */
    val id: String,
    val files: List<PackFile>,
    /** Every binary's path; [binary] reads its bytes when the pack needs them. */
    val binaries: List<String>,
    /** A binary's bytes; null skips it, a throw fails the whole build. */
    val binary: (String) -> ByteArray?,
    val overlayImages: List<OverlayImageRequest> = emptyList(),
    /** The Project's folder, which names it on the plugin side (Bedrock menu keys, `<folder>:<name>` of an image, [ImageNames]); defaults to [id]. */
    val folder: String = id,
    /**
     * A folder of `themes/` (the Project roots' `role`). One other than the common images' holds
     * no Document and no image of its own in the pack: it is read as a theme when the server has
     * it in place ([KitTheme]).
     */
    val theme: Boolean = false,
)

class PackInput(
    val projects: List<PackProject>,
    /** `resource-pack.container-textures.<chest|hopper|dispenser>` of `config.yml`, as `<project>:<asset>`. */
    val containerTextures: Map<String, String> = emptyMap(),
    /** Redraw the containers a menu makes transparent (`vanilla_gui_v1`). */
    val transparentContainers: Boolean = true,
    /** `resource-pack.hide-inventory-label` of `config.yml`: empty the client's "Inventory" label ([InventoryLabel]). */
    val hideInventoryLabel: Boolean = false,
    /** Also build the server's Bedrock pack; the id seeds its uuid. */
    val bedrockServerId: String? = null,
    /** `resource-pack.themes` of `config.yml`: the themes `kit:` images are shown in, the lowest first ([ThemeStack]); one the kit module does not hold is left out. */
    val themes: List<String> = emptyList(),
)

/** The Java pack, and the Bedrock one when [PackInput.bedrockServerId] asked for it. */
class PackResult(val zip: ByteArray, val sha1: String, val bedrock: BedrockPackResult? = null)

/**
 * The server's Java resource pack, port of the editor's `packAssembly.ts` and
 * `resourcePackBuilder.ts`. Same inputs, same bytes: `testdata/resource-pack-conformance.json`
 * locks both builders. Pure: no I/O but [PackProject.binary] and the jar's own resources.
 */
object ResourcePackBuilder {
    private const val CODEPOINT_MIN = 0xe000
    private const val CODEPOINT_MAX = 0xf7ff

    private val PACK_MCMETA = mapOf(
        "pack" to mapOf(
            "pack_format" to 64,
            "supported_formats" to mapOf("min_inclusive" to 22, "max_inclusive" to 200),
            "description" to "Artisan pack",
        ),
    )

    private val PACK_PNG_FALLBACK = intArrayOf(
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08, 0x08, 0x06, 0x00, 0x00, 0x00, 0xc4, 0x0f, 0xbe,
        0x8b, 0x00, 0x00, 0x00, 0x0f, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x18, 0x05, 0xa3,
        0x60, 0x14, 0x8c, 0x02, 0x00, 0x00, 0x60, 0x00, 0x01, 0x44, 0x40, 0xf4, 0xfc, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ).let { ints -> ByteArray(ints.size) { ints[it].toByte() } }

    /** Vanilla textures bundled in the jar (copied from the editor's assets at build time). */
    internal fun vanillaResource(path: String): ByteArray =
        ResourcePackBuilder::class.java.getResourceAsStream("minecraft/$path")?.use { it.readBytes() }
            ?: error("vanilla texture $path missing from the jar")

    fun build(input: PackInput): PackResult {
        // The common images ([Kit]): the server's by name, and the base as the server holds it.
        val kitFolder = Kit.folderAmong(input.projects.map { it.folder })
        // The server's themes, each a Project of its name: read when in place, never as a module.
        val themeProjects = input.projects.filter { it.theme && it.folder != kitFolder }.associateBy { it.folder }
        val projects = input.projects.filterNot { it.theme && it.folder != kitFolder }.sortedWith { a, b -> a.id.compareTo(b.id) }
        val allAssets = ArrayList<AssetRow>()
        val contribs = ArrayList<Pair<String, List<Pair<String, Double>>>>()
        val glyphPngs = HashMap<String, ByteArray>()
        val fontGlyphPngs = HashMap<String, Map<String, ByteArray>>()
        // A menu's image names are read with its module's folder, once every module's images are known.
        val names = ImageNames()
        val placedGlyphs = ArrayList<Pair<String, GlyphPlacement>>()
        val placedButtons = ArrayList<Pair<String, ImageButtonPlacement>>()
        val askedOverlays = ArrayList<Pair<String, OverlayImageRequest>>()
        val textPlacements = ArrayList<TextPlacement>()
        val transparent = LinkedHashSet<GuiContainer>()
        val imagesByRef = ArrayList<Pair<String, ByteArray>>()
        val texts = ArrayList<String>()
        val titleImages = ArrayList<Pair<String, String>>()
        // The common images ([Kit]): the server's by name, and the base as the server holds it.
        val kitProject = projects.firstOrNull { it.folder == kitFolder }
        val kitImages = HashMap<String, ByteArray>()
        val kitBase = HashMap<String, ByteArray?>()
        val kitImage = { name: String ->
            Kit.image(name, kitImages[name], kitBase.getOrPut(name) { kitProject?.takeIf { Kit.shippedPath(name) in it.binaries }?.binary(Kit.shippedPath(name)) })
        }
        val composed = ArrayList<Composed>()
        // The common images' names, before any module's image is named ([ImageNames.common]). A
        // server older than the theme `artisan` keeps the ids it had.
        val shippedNames = kitProject?.binaries.orEmpty().mapNotNull(Kit::shippedName)
        if (kitProject?.folder == Kit.FOLDER) {
            DiskAssets.fromTree(kitProject.id, kitProject.files, kitProject.binaries, originals = false)
                .filter { it.row.type == "glyph" || it.row.type == "texture" }
                .forEach { names.common(it.row.id) }
            for (name in shippedNames + Kit.slots.map { it.id }) names.common(name)
        }

        // The themes in place ([ThemeStack]), the lowest first: they change the common images, and
        // redraw the modules' images they name.
        val theme = KitTheme.stack(input.themes, kitProject, themeProjects)

        for (project in projects) {
            val files = project.files
            // Any text of the Project may reach a title (menus, lang files, data rows): its symbols ride along.
            files.mapTo(texts) { it.content }
            MenuReaders.glyphPlacements(files).mapTo(placedGlyphs) { project.folder to it }
            MenuReaders.titleImages(files).mapTo(titleImages) { project.folder to it }
            MenuReaders.imageButtons(files).mapTo(placedButtons) { project.folder to it }
            textPlacements += MenuReaders.textPlacements(files)
            project.overlayImages.mapTo(askedOverlays) { project.folder to it }
            transparent += MenuReaders.transparentContainers(files)
            // The theme `artisan` holds the common images: one enters the pack as `kit:<name>` when a
            // menu names it, never as an image of the theme's own; its originals are the base.
            val common = project.folder == Kit.FOLDER
            // The owner's image of an original that declares a function is taken at its measures only.
            val sizes = HashMap<String, Pair<Int, Int>?>()
            val fromDisk = DiskAssets.fromTree(project.id, files, project.binaries, originals = !common) { path ->
                sizes.getOrPut(path) { ImageFunctions.pixelSize(project.binary(path)) }
            }
            // An image the module is not the first to hold under that name gets its module's id ([ImageNames]).
            val rows = fromDisk.map { a ->
                val image = a.row.type == "glyph" || a.row.type == "texture"
                when {
                    image && common -> a.row
                    image -> ImageNames.named(a.row, names.claim(project.folder, a.row.id), project.folder)
                    else -> a.row.also { names.take(it.id) }
                }
            }
            contribs += project.id to rows
                .filter { it.type == "glyph" && it.codepoint != null && !common }
                .map { it.id to it.codepoint!! }
            // The module's own PNGs by name: what its composed images are made of.
            val own = HashMap<String, ByteArray>()
            for ((i, a) in fromDisk.withIndex()) {
                val row = rows[i]
                if (common && (row.type == "glyph" || row.type == "texture")) {
                    if (a.recipe != null) composed += Composed(null, project, a.recipe, own, a.row.name)
                    else project.binary(a.path)?.let { bytes ->
                        imagesByRef += "${project.id}:${a.row.name}" to bytes
                        own[a.row.name] = bytes
                        kitImages[a.row.name] = bytes
                    }
                    continue
                }
                allAssets += row
                if ((row.type == "glyph" && row.codepoint != null) || row.type == "texture") {
                    if (a.recipe != null) {
                        composed += Composed(allAssets.lastIndex, project, a.recipe, own, a.row.name)
                        continue
                    }
                    val disk = project.binary(a.path) ?: continue
                    // A theme in place may redraw a module's image, at its size (`overrides/<module>/`).
                    val bytes = theme?.moduleDrawing(project.folder, a.row.name, disk) ?: disk
                    glyphPngs[row.id] = bytes
                    imagesByRef += "${project.id}:${a.row.name}" to bytes
                    own[a.row.name] = bytes
                    if (project.folder == kitFolder) kitImages[a.row.name] = bytes
                    continue
                }
                if (row.type != "font") continue
                // A font is unpacked on disk: its glyphs are sibling files of the descriptor.
                val meta = row.fontMeta as? FontMeta
                val dir = a.path.substringBeforeLast('/')
                val fontMap = LinkedHashMap<String, ByteArray>()
                for (g in meta?.glyphMap.orEmpty()) project.binary("$dir/${g.texture}")?.let { fontMap[g.texture] = it }
                if (fontMap.isNotEmpty()) fontGlyphPngs[row.id] = fontMap
            }
        }

        // Composed images ([ComposedImages]), once every module's PNGs are read: a layer is a PNG
        // of the module or a kit image, never another composed image, so their order does not matter.
        // The themes in place change the kit's PNGs, the base's and the server's: an image
        // composed with them follows, and is not themed a second time once assembled.
        val kitPng = { name: String -> kitImage(name)?.png?.let { theme?.shown(name, it) ?: it } }
        val made = composed.mapNotNull { c ->
            // In the kit module an image is a kit image under its bare name too.
            val own: (String) -> ByteArray? =
                if (theme != null && c.project.folder == kitFolder) { name -> c.own[name]?.let { theme.shown(name, it) } } else c.own::get
            ComposedImages.render(c.recipe, own, kitPng)?.let { c to it }
        }
        val kitComposed = HashSet<String>()
        for ((c, image) in made) {
            val bytes = Png.encode(image)
            // A composed common image has no row of its own: it is a `kit:<name>` once named.
            if (c.index != null) {
                val row = allAssets[c.index].copy(width = image.width.toDouble(), height = image.height.toDouble())
                allAssets[c.index] = row
                glyphPngs[row.id] = bytes
            }
            imagesByRef += "${c.project.id}:${c.name}" to bytes
            if (c.project.folder == kitFolder) {
                kitImages[c.name] = bytes
                kitComposed += c.name
            }
        }

        // A name no module holds reaches the common image of that name ([ImageNames.resolve]).
        for (name in kitImages.keys + shippedNames + Kit.slots.map { it.id }) names.take(Kit.PREFIX + name)

        val glyphPlacements = placedGlyphs.map { (folder, p) -> p.copy(assetId = names.resolve(folder, p.assetId)) }
        val imageButtons = placedButtons.map { (folder, b) -> b.copy(asset = names.resolve(folder, b.asset)) }
        // The plugin asks for a module's image by its name alone (`OverlayApi.image`): the key keeps
        // the name, the picture is the asking module's own.
        val overlayImages = askedOverlays.map { (folder, r) -> OverlayAsk(r, names.resolve(folder, r.asset)) }

        // `kit:<name>` ([Kit]): only the ones a menu or a module asks for, so a server that names
        // none keeps the pack it had. One a title is drawn with is a glyph of the menu font, at
        // the first codepoint no module's glyph has; the others are textures.
        val inTitles = titleImages.mapNotNullTo(HashSet()) { (folder, ref) -> Kit.nameOf(names.resolve(folder, ref)) }
        val asked = (inTitles + (imageButtons.map { it.asset } + overlayImages.map { it.image }).mapNotNull(Kit::nameOf)).distinct().sorted()
        val kitGlyphs = ArrayList<Pair<String, Double>>()
        for (name in asked) {
            val image = kitImage(name) ?: continue
            val id = Kit.PREFIX + name
            val glyph = name in inTitles
            allAssets += AssetRow(
                id, Kit.FOLDER, if (glyph) "glyph" else "texture", Kit.FILES + name, image.width.toDouble(), image.height.toDouble(),
                if (glyph) Kit.ASCENT else null, if (glyph) CODEPOINT_MIN.toDouble() else null, null, null,
            )
            if (glyph) kitGlyphs += id to CODEPOINT_MIN.toDouble()
            glyphPngs[id] = when {
                theme == null -> image.png
                // Assembled from themed layers already: only the theme's own drawing of it replaces it.
                !image.shipped && name in kitComposed -> theme.drawing(name, image.png) ?: image.png
                else -> theme.shown(name, image.png)
            }
        }
        if (kitGlyphs.isNotEmpty()) contribs += Kit.FOLDER to kitGlyphs

        val finalCodepoints = mergeCodepoints(contribs)
        val sources = GuiContainer.entries.associateWith { c ->
            VanillaGui.textureSource(imagesByRef, input.containerTextures[c.key]) ?: vanillaResource("${c.textureFile}.png")
        }
        val java = zip(
            allAssets,
            glyphPngs,
            fontGlyphPngs,
            finalCodepoints,
            glyphPlacements,
            imageButtons,
            sources,
            if (input.transparentContainers) transparent else emptySet(),
            overlayImages,
            input.hideInventoryLabel,
            Symbols.used(texts),
            textPlacements,
            TextDecorations.used(texts),
            TextChars.sheets(TextChars.used(texts)),
        )
        val serverId = input.bedrockServerId ?: return java
        // Asset names collide across Projects as the Java pack resolves them: the first Project (by id) wins.
        // By id, what a menu writes: a file's name, `kit:<name>` for a kit image.
        val pngsByName = LinkedHashMap<String, ByteArray>()
        for (a in allAssets) glyphPngs[a.id]?.let { pngsByName.putIfAbsent(a.id, it) }
        // Keyed by the folder name: the plugin names a menu's Project that way.
        val bedrockMenus = projects.flatMap { p -> BedrockMenus.fromProject(p.folder, p.files) { names.resolve(p.folder, it) } }
        val bedrock = BedrockPack.build(serverId, bedrockMenus, pngsByName, allAssets, sources.getValue(GuiContainer.CHEST))
        return PackResult(java.zip, java.sha1, bedrock)
    }

    /** A composed image waiting for its layers: its row's place, its module, that module's PNGs and its [name] there. */
    private class Composed(val index: Int?, val project: PackProject, val recipe: ComposedImages.Recipe, val own: Map<String, ByteArray>, val name: String)

    /** First Project wins a codepoint; a later one taking it again moves to the first free one. */
    private fun mergeCodepoints(contribs: List<Pair<String, List<Pair<String, Double>>>>): Map<String, Double> {
        val used = HashSet<Double>()
        val out = HashMap<String, Double>()
        for ((_, glyphs) in contribs) {
            for ((assetId, codepoint) in glyphs) {
                var target = codepoint
                if (target in used) {
                    target = (CODEPOINT_MIN..CODEPOINT_MAX).firstOrNull { it.toDouble() !in used }?.toDouble() ?: (CODEPOINT_MAX + 1.0)
                }
                if (target > CODEPOINT_MAX) throw IllegalStateException("Codepoint range exhausted (U+E000–U+F7FF)")
                used += target
                out[assetId] = target
            }
        }
        return out
    }

    private fun zip(
        assets: List<AssetRow>,
        glyphPngs: Map<String, ByteArray>,
        fontGlyphPngs: Map<String, Map<String, ByteArray>>,
        finalCodepoints: Map<String, Double>,
        glyphPlacements: List<GlyphPlacement>,
        imageButtons: List<ImageButtonPlacement>,
        sources: Map<GuiContainer, ByteArray>,
        transparent: Set<GuiContainer>,
        overlayImages: List<OverlayAsk>,
        hideInventoryLabel: Boolean,
        symbols: List<Int>,
        textPlacements: List<TextPlacement>,
        decorations: Boolean,
        textChars: List<TextSheet>,
    ): PackResult {
        val remapped = assets.map { a ->
            if (a.type != "glyph" || a.codepoint == null) a
            else finalCodepoints[a.id]?.let { a.copy(codepoint = it) } ?: a
        }
        val files = LinkedHashMap<String, ByteArray>()
        files["pack.mcmeta"] = Js.stringifyBytes(PACK_MCMETA, 2)
        files["pack.png"] = PACK_PNG_FALLBACK
        files["assets/artisan/font/default.json"] = Js.stringifyBytes(Fonts.defaultFontJson(remapped), 2)

        val index = AssetIndex(remapped, transparent)
        VanillaGui.files(sources, transparent, files)
        if (hideInventoryLabel) InventoryLabel.files(files)
        ImageButtons.build(files, index, glyphPngs, imageButtons)
        OverlayImages.build(files, index, glyphPngs, overlayImages)
        files["assets/artisan/asset-index.json"] = Js.stringifyBytes(index.json(), 2)

        val rows = Symbols.rows(symbols)
        if (rows.isNotEmpty()) files["assets/artisan/textures/font/symbols.png"] = Png.encode(Symbols.sheet(symbols))
        if (decorations) files["assets/artisan/textures/font/decorations.png"] = Png.encode(TextDecorations.sheet())
        // Size 8 at every Y (`api.getOverlay().raise` picks any at run time), the other sizes at
        // the Ys the menus' texts and labels sit at (`resourcePackBuilder.ts`).
        for (h in MenuReaders.TEXT_SIZES) {
            val range = Fonts.minYForSize(h)..MenuReaders.TEXT_Y_MAX
            val ys = if (h == 8) range.toList()
            else textPlacements.filter { it.size == h && it.y in range }.map { it.y }.distinct().sorted()
            for (y in ys) {
                files["assets/artisan/font/text_y${y}_h$h.json"] = Js.stringifyBytes(Fonts.textYFontJson(y, h, rows, decorations, textChars))
            }
        }
        TextChars.files(textChars, { name -> vanillaResource("font/${name}_up.png") }, files)
        if (rows.isNotEmpty()) {
            files["assets/artisan/textures/font/symbols_up.png"] = Png.encode(Symbols.sheet(symbols, 2 * Symbols.UP_FULL_MAX))
            files["assets/artisan/textures/font/symbols_up_half.png"] = Png.encode(Symbols.sheet(symbols, Fonts.TEXT_UP_PAD, half = true))
        }
        for (rise in 0..Fonts.TEXT_UP_MAX) files["assets/artisan/font/text_up$rise.json"] = Js.stringifyBytes(Fonts.textUpFontJson(rise, rows, textChars))

        val glyphs = remapped.filter { it.type == "glyph" && it.codepoint != null }.sortedBy { it.codepoint }
        for (g in glyphs) files["assets/artisan/textures/font/${g.name}.png"] = glyphPngs[g.id] ?: continue

        val glyphsById = glyphs.associateBy { it.id }
        val glyphsByY = LinkedHashMap<Double, LinkedHashMap<String, AssetRow>>()
        for ((assetId, y) in glyphPlacements) {
            val g = glyphsById[assetId] ?: continue
            val effectiveY = maxOf(y, Fonts.glyphYFloor(g.height))
            if (effectiveY == Fonts.defaultGlyphY(g.ascent)) continue
            glyphsByY.getOrPut(effectiveY) { LinkedHashMap() }[g.id] = g
        }
        for ((y, atY) in glyphsByY) {
            files["assets/artisan/font/glyph_y${Js.numberString(y)}.json"] = Js.stringifyBytes(Fonts.glyphYFontJson(y, atY.values), 2)
        }

        val fontAssets = assets.filter { it.type == "font" && it.fontMeta != null }.sortedWith { a, b -> a.name.compareTo(b.name) }
        for (fa in fontAssets) {
            val meta = fa.fontMeta as? FontMeta ?: continue
            val providers = meta.glyphMap.map { g ->
                mapOf("type" to "bitmap", "file" to "artisan:font/${fa.name}/${g.texture}", "ascent" to g.ascent, "height" to g.height, "chars" to listOf(g.char))
            }
            files["assets/artisan/font/${fa.name}.json"] = Js.stringifyBytes(mapOf("providers" to providers), 2)
            val pngs = fontGlyphPngs[fa.id] ?: continue
            for (g in meta.glyphMap) files["assets/artisan/textures/font/${fa.name}/${g.texture}"] = pngs[g.texture] ?: continue
        }

        val zip = Zip.write(files)
        return PackResult(zip, sha1Hex(zip))
    }
}
