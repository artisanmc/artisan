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
    /** The Project's folder, which names it on the plugin side (Bedrock menu keys); defaults to [id]. */
    val folder: String = id,
)

class PackInput(
    val projects: List<PackProject>,
    /** `resource-pack.container-textures.<chest|hopper|dispenser>` of `config.yml`, as `<project>:<asset>`. */
    val containerTextures: Map<String, String> = emptyMap(),
    /** Redraw the containers a menu makes transparent (`vanilla_gui_v1`). */
    val transparentContainers: Boolean = true,
    /** Also build the server's Bedrock pack; the id seeds its uuid. */
    val bedrockServerId: String? = null,
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
    private val TEXT_SIZES = listOf(8, 12, 16, 20, 24, 32)

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
        val projects = input.projects.sortedWith { a, b -> a.id.compareTo(b.id) }
        val allAssets = ArrayList<AssetRow>()
        val contribs = ArrayList<Pair<String, List<Pair<String, Double>>>>()
        val glyphPngs = HashMap<String, ByteArray>()
        val fontGlyphPngs = HashMap<String, Map<String, ByteArray>>()
        val glyphPlacements = ArrayList<GlyphPlacement>()
        val imageButtons = ArrayList<ImageButtonPlacement>()
        val transparent = LinkedHashSet<GuiContainer>()
        val imagesByRef = ArrayList<Pair<String, ByteArray>>()
        val overlayImages = ArrayList<OverlayImageRequest>()
        val bedrockMenus = ArrayList<BedrockMenu>()

        for (project in projects) {
            val files = project.files
            glyphPlacements += MenuReaders.glyphPlacements(files)
            imageButtons += MenuReaders.imageButtons(files)
            overlayImages += project.overlayImages
            transparent += MenuReaders.transparentContainers(files)
            // Keyed by the folder name: the plugin names a menu's Project that way.
            if (input.bedrockServerId != null) bedrockMenus += BedrockMenus.fromProject(project.folder, files)
            val fromDisk = DiskAssets.fromTree(project.id, files, project.binaries)
            contribs += project.id to fromDisk
                .filter { it.row.type == "glyph" && it.row.codepoint != null }
                .map { it.row.id to it.row.codepoint!! }
            for (a in fromDisk) {
                allAssets += a.row
                if ((a.row.type == "glyph" && a.row.codepoint != null) || a.row.type == "texture") {
                    val bytes = project.binary(a.path) ?: continue
                    glyphPngs[a.row.id] = bytes
                    imagesByRef += "${project.id}:${a.row.name}" to bytes
                    continue
                }
                if (a.row.type != "font") continue
                // A font is unpacked on disk: its glyphs are sibling files of the descriptor.
                val meta = a.row.fontMeta as? FontMeta
                val dir = a.path.substringBeforeLast('/')
                val fontMap = LinkedHashMap<String, ByteArray>()
                for (g in meta?.glyphMap.orEmpty()) project.binary("$dir/${g.texture}")?.let { fontMap[g.texture] = it }
                if (fontMap.isNotEmpty()) fontGlyphPngs[a.row.id] = fontMap
            }
        }

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
        )
        val serverId = input.bedrockServerId ?: return java
        // Asset names collide across Projects as the Java pack resolves them: the first Project (by id) wins.
        val pngsByName = LinkedHashMap<String, ByteArray>()
        for (a in allAssets) glyphPngs[a.id]?.let { pngsByName.putIfAbsent(a.name, it) }
        val bedrock = BedrockPack.build(serverId, bedrockMenus, pngsByName, allAssets, sources.getValue(GuiContainer.CHEST))
        return PackResult(java.zip, java.sha1, bedrock)
    }

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
        overlayImages: List<OverlayImageRequest>,
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
        ImageButtons.build(files, index, glyphPngs, imageButtons)
        OverlayImages.build(files, index, glyphPngs, overlayImages)
        files["assets/artisan/asset-index.json"] = Js.stringifyBytes(index.json(), 2)

        for (h in TEXT_SIZES) {
            for (y in Fonts.minYForSize(h)..172) {
                files["assets/artisan/font/text_y${y}_h$h.json"] = Js.stringifyBytes(Fonts.textYFontJson(y, h), 2)
            }
        }
        for (name in Fonts.TEXT_UP_TEXTURES) files["assets/artisan/textures/font/${name}_up.png"] = vanillaResource("font/${name}_up.png")
        for (rise in 0..Fonts.TEXT_UP_MAX) files["assets/artisan/font/text_up$rise.json"] = Js.stringifyBytes(Fonts.textUpFontJson(rise), 2)

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
