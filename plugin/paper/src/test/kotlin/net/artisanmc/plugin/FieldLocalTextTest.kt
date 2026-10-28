package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.MenuTitleParser
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.DialogYaml
import net.artisanmc.plugin.model.LocalizedText
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.title.TitleCompiler
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * ADR `field-local-translations` — a structural text slot is either a bare
 * string (same for every language) or a `{lang: text}` map resolved requested →
 * default → any.
 */
class FieldLocalTextTest {

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    @Test
    fun `bare string renders for every language`() {
        val t = mapper.readValue("Retour", LocalizedText::class.java)
        assertEquals("Retour", t.forLang("en", "en"))
        assertEquals("Retour", t.forLang("fr", "de"))
        assertFalse(t.isMap)
    }

    @Test
    fun `map picks requested then default then any`() {
        val t = mapper.readValue("{fr: Retour, en: Back}", LocalizedText::class.java)
        assertEquals("Back", t.forLang("en", "fr"))
        assertEquals("Retour", t.forLang("fr", "en"))
        assertEquals("Back", t.forLang("de", "en"))
        assertTrue(t.isMap)
        // No default entry → falls back to any present value.
        assertEquals("Retour", mapper.readValue("{fr: Retour}", LocalizedText::class.java).forLang("en", "en"))
    }

    @Test
    fun `appearance title and lore accept a lang map`() {
        val app = mapper.readValue(
            "{title: {en: Back, fr: Retour}, lore: [{en: A, fr: B}, shared]}",
            AppearanceYaml::class.java,
        )
        assertEquals("Retour", app.title?.forLang("fr", "en"))
        assertEquals("Back", app.title?.forLang("en", "fr"))
        assertEquals("B", app.lore[0].forLang("fr", "en"))
        assertEquals("shared", app.lore[1].forLang("fr", "en"))
    }

    @Test
    fun `lore accepts one list per language, each with its own line count`() {
        val app = mapper.readValue(
            """
            lore:
              en: ["<gray>Members: {r.members}", "", "Click"]
              fr: ["<gray>Membres : {r.members}", "Clic"]
            """.trimIndent(),
            AppearanceYaml::class.java,
        )
        assertEquals(1, app.lore.size)
        assertEquals("<gray>Membres : {r.members}\nClic", app.lore[0].forLang("fr", "en"))
        assertEquals("<gray>Members: {r.members}\n\nClick", app.lore[0].forLang("en", "fr"))
        // A missing language falls back as a whole block, never line by line.
        assertEquals("<gray>Members: {r.members}\n\nClick", app.lore[0].forLang("de", "en"))
    }

    @Test
    fun `lore keeps reading lines and a bare string`() {
        assertEquals(listOf("a", "b"), mapper.readValue("{lore: [a, b]}", AppearanceYaml::class.java).lore.map { it.forLang("en", "en") })
        assertEquals(listOf("only"), mapper.readValue("{lore: only}", AppearanceYaml::class.java).lore.map { it.forLang("en", "en") })
        assertEquals(emptyList(), mapper.readValue("{lore: null}", AppearanceYaml::class.java).lore)
        assertEquals(emptyList(), mapper.readValue("{material: STONE}", AppearanceYaml::class.java).lore)
    }

    @Test
    fun `dialog title body and labels accept a lang map`() {
        val d = mapper.readValue(
            """
            id: d
            title: {"en": "Confirm", "fr": "Confirmer"}
            body:
              - type: text
                text: {"en": "Are you sure?", "fr": "Sûr ?"}
            inputs:
              - id: name
                label: {"en": "Name", "fr": "Nom"}
            buttons:
              - id: ok
                label: {"en": "OK", "fr": "Valider"}
            """.trimIndent(),
            DialogYaml::class.java,
        )
        assertEquals("Confirmer", d.title?.forLang("fr", "en"))
        assertEquals("Sûr ?", d.body[0].text?.forLang("fr", "en"))
        assertEquals("Nom", d.inputs[0].label?.forLang("fr", "en"))
        assertEquals("Valider", d.buttons[0].label?.forLang("fr", "en"))
    }

    @Test
    fun `menu title layer map resolves per language`() {
        val yaml = mapper.readValue(
            "{schema: menu/v1, id: m, title: [{kind: plain, value: {en: Back, fr: Retour}}]}",
            MenuYaml::class.java,
        )
        val layers = MenuTitleParser.parse(yaml.title, yaml.id)
        val plain = layers.single() as MenuTitleLayer.Plain
        assertEquals(mapOf("en" to "Back", "fr" to "Retour"), plain.value.localized)

        val fr = TitleCompiler.compileTitle(layers, lang = "fr", langMap = emptyMap(), lookupAsset = { null }, defaultLang = "en")
        val en = TitleCompiler.compileTitle(layers, lang = "en", langMap = emptyMap(), lookupAsset = { null }, defaultLang = "fr")
        assertTrue(fr.toString().contains("Retour"), "fr title: $fr")
        assertTrue(en.toString().contains("Back"), "en title: $en")
    }
}
