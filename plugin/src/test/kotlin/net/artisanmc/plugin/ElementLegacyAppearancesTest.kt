package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.MenuYaml
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Les menus écrits AVANT le passage au display à plat portent `appearances:` —
 * une liste dont la première entrée fait office de display.
 *
 * Le lecteur ne les reconnaissait plus : display vide, donc un menu qui s'ouvre
 * sans ses items, en jeu comme dans l'éditeur. Pas d'erreur, pas de log — juste
 * des cases vides sur un fichier parfaitement valide. Un Add-on dont le
 * bootstrap ne retouche jamais un project existant laisse ces fichiers en place
 * indéfiniment : personne ne les réécrira à notre place.
 *
 * On les lit donc encore. L'éditeur, lui, réécrit au format courant dès le
 * premier enregistrement — la tolérance est un pont, pas une seconde forme.
 */
class ElementLegacyAppearancesTest {

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    private fun parse(yaml: String): MenuYaml = mapper.readValue(yaml.trimIndent(), MenuYaml::class.java)

    @Test
    fun `la premiere appearance devient le display, les suivantes des states`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: acheter
                positions: 11
                appearances:
                  - material: DIAMOND
                    title: "Acheter"
                  - material: BARRIER
                    if:
                      - type: has_permission
                        perm: vip
            """,
        )
        val el = menu.allElements.single()
        assertEquals("DIAMOND", el.display.material)
        assertEquals(1, el.states.size)
        assertEquals("BARRIER", el.states.single().material)
    }

    @Test
    fun `le format courant l'emporte sur une liste residuelle`() {
        val menu = parse(
            """
            schema: menu/v1
            id: shop
            size: 27
            elements:
              - id: acheter
                positions: 11
                material: ARROW
                appearances:
                  - material: DIAMOND
            """,
        )
        assertEquals("ARROW", menu.allElements.single().display.material)
    }
}
