package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer
import kotlin.test.*

/**
 * Inline i18n: a menu file carries the DEFAULT language's text literally, and
 * the other languages travel in `lang/<lang>.yaml` keyed by the site's canonical
 * ADDRESS (`menus.<m>.elements.<el>.<state>.title`) — the same addressing the
 * editor's key-site visitor produces.
 *
 * Resolution order at render time is: an explicit `{i18n:key}` ref wins, then
 * the address, then the literal itself. Without the address step a literal is
 * simply untranslatable, which is what made inline mode mono-language only.
 */
class InlineI18nAddressTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun legacy(c: net.kyori.adventure.text.Component?) =
        c?.let { LegacyComponentSerializer.legacySection().serialize(it) }

    /** Inline form: the literal IS the default-language text. */
    private fun menu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: shop
        title: []
        size: 27
        elements:
          - id: buy
            positions: 10
            material: STONE
            title: "Sword"
            lore: ["Sharp"]
          - id: info
            positions: 11
            material: STONE
            title: "{i18n:custom.legacy.key}"
        """.trimIndent(),
    )

    private val fr = mapOf(
        "menus.shop.elements.buy.default.title" to "Épée",
        "menus.shop.elements.buy.default.lore" to "Tranchante",
        "custom.legacy.key" to "Légende",
    )

    private fun render(lang: String, langMaps: Map<String, Map<String, String>>): List<String?> {
        val p = player()
        val m = BundleCompiler.compile(menu(), langMaps, defaultLang = "en")
        MenuRenderer.open(p, m, lang, ExecutionContext(p))
        val inv = p.openInventory.topInventory
        return listOf(
            legacy(inv.getItem(10)?.itemMeta?.displayName()),
            legacy(inv.getItem(10)?.itemMeta?.lore()?.firstOrNull()),
            legacy(inv.getItem(11)?.itemMeta?.displayName()),
        )
    }

    @Test fun `a literal title and lore resolve through their canonical address`() {
        val (title, lore, _) = render("fr", mapOf("fr" to fr))
        assertEquals("Épée", title)
        assertEquals("\u00a7fTranchante", lore)
    }

    @Test fun `the literal stands in when the language has no entry at that address`() {
        val (title, lore, _) = render("en", mapOf("fr" to fr))
        assertEquals("Sword", title)
        assertEquals("\u00a7fSharp", lore)
    }

    @Test fun `an explicit i18n ref still wins over the address`() {
        val (_, _, legacyTitle) = render("fr", mapOf("fr" to fr))
        assertEquals("Légende", legacyTitle)
    }

    @Test fun `the compiled appearance carries the address the editor would mint`() {
        val m = BundleCompiler.compile(menu(), emptyMap(), defaultLang = "en")
        assertEquals(
            "menus.shop.elements.buy.default",
            m.compiledAppearances["buy"]?.first()?.i18nBase,
        )
    }

    @Test fun `a literal menu title translates through its address, a ref still renders empty when missing`() {
        val titled: MenuYaml = mapper.readValue(
            """
            schema: menu/v1
            id: shop
            title: "Shop"
            size: 27
            elements: []
            """.trimIndent(),
        )
        val plain = BundleCompiler.compile(titled, emptyMap()).title.single()
            as net.artisanmc.plugin.model.MenuTitleLayer.Plain
        assertEquals("menus.shop.title", plain.value.address)
        assertTrue(plain.value.literal)

        // A ref, by contrast, is not literal: an unresolved one must render empty
        // rather than echo `menus.shop.title` at the player.
        val ref: MenuYaml = mapper.readValue(
            """
            schema: menu/v1
            id: shop
            title: "{i18n:menus.shop.title}"
            size: 27
            elements: []
            """.trimIndent(),
        )
        val refLayer = BundleCompiler.compile(ref, emptyMap()).title.single()
            as net.artisanmc.plugin.model.MenuTitleLayer.Plain
        assertFalse(refLayer.value.literal)
    }

    @Test fun `later appearance states are addressed state1, state2 …`() {
        val multi: MenuYaml = mapper.readValue(
            """
            schema: menu/v1
            id: shop
            title: []
            size: 27
            elements:
              - id: buy
                positions: 10
                material: STONE
                title: "A"
                states:
                  - material: DIRT
                    title: "B"
                  - material: SAND
                    title: "C"
            """.trimIndent(),
        )
        val bases = BundleCompiler.compile(multi, emptyMap()).compiledAppearances["buy"]!!.map { it.i18nBase }
        // Compiled in RESOLUTION order — states first, the display last as the
        // fallback — while the ADDRESSES stay display-first (ADR
        // `element-display-and-states`).
        assertEquals(
            listOf(
                "menus.shop.elements.buy.state1",
                "menus.shop.elements.buy.state2",
                "menus.shop.elements.buy.default",
            ),
            bases,
        )
    }
}
