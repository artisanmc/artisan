package net.artisanmc.plugin.project

import net.artisanmc.plugin.project.ProFeatures.RESOURCE_PACK
import net.artisanmc.plugin.project.ProFeatures.TITLE_COMPOSER
import net.artisanmc.plugin.project.ProFeatures.Usage
import kotlin.test.Test
import kotlin.test.assertEquals

class ProFeaturesTest {
    private fun scan(vararg files: Pair<String, String>) = ProFeatures.scan(files.associate { (p, c) -> p to c.toByteArray() })

    @Test
    fun `plain titles and items need no Pro`() {
        assertEquals(emptyList(), scan(
            "menus/a.yaml" to "title: Shop\nsize: 27\nelements:\n  - positions: '0'\n    item: { material: STONE }",
            "menus/b.yaml" to "title: { i18n: shop.title }",
            "menus/c.yaml" to "title:\n  - kind: plain\n    value: { key: k }",
            "dialogs/d.yaml" to "title: [ { kind: glyph } ]",
            "lang/fr.yaml" to "a: b",
        ))
    }

    @Test
    fun `composed titles, images and transparent windows need Pro`() {
        assertEquals(listOf(
            Usage(TITLE_COMPOSER, "menus/a.yaml"),
            Usage(RESOURCE_PACK, "menus/b.yaml"),
            Usage(RESOURCE_PACK, "menus/c.yml"),
            Usage(RESOURCE_PACK, "assets/logo.png"),
        ), scan(
            "menus/a.yaml" to "title:\n  - kind: text\n    value: { key: k }\n    x: 8\n    y: 5",
            "menus/b.yaml" to "title: Shop\nvanilla_texture: false",
            "menus/c.yml" to "elements:\n  - positions: '0'\n    states:\n      - image: { asset: banner }",
            "assets/logo.png" to "png",
        ))
    }

    @Test
    fun `a file that does not parse is not this check's business`() {
        assertEquals(emptyList(), scan("menus/broken.yaml" to "title: [unclosed"))
    }
}
