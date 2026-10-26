package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** What get_kind_guide shows a model of each shipped schema: short, readable, without the legacy forms. */
class SchemaOutlineTest {
    private fun outline(label: String) =
        SchemaOutline(ObjectMapper().readTree(javaClass.getResourceAsStream("/schema/$label.json")!!)).render()

    @Test
    fun `the menu outline lists the fields, the actions and the conditions, in a fraction of the schema`() {
        val text = outline("menu/v1")
        assertTrue(text.length < 20_000, "outline is ${text.length} characters")
        assertTrue("- size (required): " in text)
        assertTrue("- run_command: " in text)
        assertTrue("- has_permission: string" in text)
        assertFalse("ConditionLegacy" in text)
        assertFalse("- layers" in text, "legacy fields are left out")
    }

    @Test
    fun `every shipped schema renders`() {
        for (label in listOf("command/v1", "dialog/v1", "trigger/v1")) assertTrue(outline(label).startsWith("## Fields\n- schema"), label)
    }
}
