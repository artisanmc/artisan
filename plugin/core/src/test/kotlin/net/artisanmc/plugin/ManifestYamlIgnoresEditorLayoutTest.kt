package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.ManifestYaml
import kotlin.test.Test
import kotlin.test.assertEquals

class ManifestYamlIgnoresEditorLayoutTest {

    private val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule()

    @Test fun `editor_layout field is silently ignored on parse`() {
        val src = """
            schema: manifest/v1
            project_id: p_test
            default_lang: en
            languages: [en]
            files:
              menus: [shop]
              commands: []
              dialogs: []
            editor_layout:
              shop: { x: 40, y: 80 }
        """.trimIndent()

        val manifest = yaml.readValue(src, ManifestYaml::class.java)

        assertEquals("p_test", manifest.projectId)
        assertEquals(listOf("shop"), manifest.files.menus)
        // No exception thrown — that's the contract this test pins.
    }
}
