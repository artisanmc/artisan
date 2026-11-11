package net.artisanmc.plugin.hub

import kotlin.test.Test
import kotlin.test.assertTrue

/** The parts of get_kind_guide that depend on the Project and the server, beyond the schema's outline. */
class KindGuideTest {
    private val kind = mapOf("kind" to "quest_group", "dir" to "quest_groups", "schema_versions" to listOf("quest_group/v1"))

    @Test
    fun `a module kind without a schema still gets the Project's languages and the server's actions`() {
        val files = mapOf("artisan-module.yml" to "schema: module/v1\ndefault_lang: fr\nlanguages: [fr, en]\n", "lang/de.yml" to "a: b\n")
        val actions = listOf(mapOf("name" to "quests:start", "module_id" to "msquests", "args" to listOf(
            mapOf("name" to "quest", "type" to mapOf("kind" to "document_ref", "document" to "quest_group"), "required" to true),
            mapOf("name" to "silent", "type" to mapOf("kind" to "boolean"), "default" to false),
        )))
        val text = KindGuide("quest_group", kind, null, actions, files, "quest_groups/daily.yml" to "schema: quest_group/v1\n").render(full = false)
        assertTrue("no schema ships with Artisan" in text, text)
        assertTrue("- quests:start (module msquests): {quest: id of a quest_group Document, silent?: boolean = false}\n" in text, text)
        assertTrue("This Project's default language is `fr`, with `en`, `de`.\n" in text, text)
        assertTrue("## Example: quest_groups/daily.yml\n```yaml\nschema: quest_group/v1\n```\n" in text, text)
        assertTrue(text.trimEnd().endsWith("read_docs lists Artisan's docs."), text)
    }
}
