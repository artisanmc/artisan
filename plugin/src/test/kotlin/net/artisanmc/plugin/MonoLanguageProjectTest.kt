package net.artisanmc.plugin

import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

/**
 * Hybrid export: a single-language project ships inline literals and NO lang/
 * directory. The reader must load it and keep literals intact end-to-end.
 */
class MonoLanguageProjectTest {

    @Test
    fun `project without lang dir loads with inline literals`(@TempDir root: File) {
        val proj = File(root, "shop_proj").apply { mkdirs() }
        File(proj, "manifest.yaml").writeText(
            """
            schema: manifest/v1
            project_id: shop_proj
            default_lang: en
            languages: [en]
            files:
              menus: [shop]
              commands: []
              dialogs: []
            """.trimIndent()
        )
        File(proj, "menus").mkdirs()
        File(proj, "menus/shop.yaml").writeText(
            """
            schema: menu/v1
            id: shop
            title:
              - kind: plain
                value: "<gold>Boutique"
            size: 27
            layers:
              - id: base
                name: Base
                elements:
                  - id: sword
                    positions: "4"
                    appearances:
                      - material: iron_sword
                        title: "Épée en fer"
                        lore:
                          - "Une épée robuste"
                          - "Ligne deux"
            """.trimIndent()
        )

        val bundles = ProjectReader(root).readAll()
        assertEquals(1, bundles.size)
        val menu = bundles.single().menus.single()

        val titleLayer = menu.title.single() as MenuTitleLayer.Plain
        assertEquals("<gold>Boutique", titleLayer.value.literal)

        val app = menu.compiledAppearances.getValue("sword").single()
        assertEquals("Épée en fer", app.yaml.title)
        assertEquals(listOf("Une épée robuste", "Ligne deux"), app.yaml.lore)
    }
}
