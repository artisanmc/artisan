package net.artisanmc.plugin

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.AppearanceYaml
import net.artisanmc.plugin.model.ELEMENT_STRUCTURAL_KEYS
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * With the display flattened onto the element (ADR `element-display-and-states`),
 * the element's own keys and an appearance's fields live in ONE namespace on the
 * wire. `testdata/element-structural-keys.json` is where that namespace is
 * written down; this test and the editor's `elementStructuralKeys.test.ts` both
 * read it, so an appearance field that would shadow a structural key fails a
 * test rather than silently winning at parse time.
 */
class ElementStructuralKeysTest {

    private fun vector(): JsonNode {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/element-structural-keys.json")
            if (f.exists()) {
                return ObjectMapper().registerKotlinModule()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                    .readTree(f)
            }
            dir = dir.parentFile
        }
        error("conformance vector not found from ${System.getProperty("user.dir")}")
    }

    private fun names(node: JsonNode, field: String): Set<String> =
        node.get(field).map { it.asText() }.toSet()

    @Test
    fun `the plugin's structural key set matches the vector`() {
        assertEquals(names(vector(), "structural"), ELEMENT_STRUCTURAL_KEYS)
    }

    @Test
    fun `no AppearanceYaml wire field shadows a structural key`() {
        val mapper = ObjectMapper().registerKotlinModule()
        val fields = mapper.valueToTree<JsonNode>(AppearanceYaml()).fieldNames().asSequence().toSet()
        val shadowing = fields.intersect(ELEMENT_STRUCTURAL_KEYS)
        assertTrue(shadowing.isEmpty(), "appearance fields shadowing structural keys: $shadowing")
    }

    @Test
    fun `every AppearanceYaml wire field is listed in the vector`() {
        val mapper = ObjectMapper().registerKotlinModule()
        val fields = mapper.valueToTree<JsonNode>(AppearanceYaml()).fieldNames().asSequence().toSet()
        val missing = fields - names(vector(), "appearance")
        assertTrue(missing.isEmpty(), "appearance fields absent from the vector: $missing")
    }
}
