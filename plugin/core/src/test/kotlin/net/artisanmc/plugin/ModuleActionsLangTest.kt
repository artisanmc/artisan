package net.artisanmc.plugin

import net.artisanmc.plugin.model.RuntimeProject
import net.artisanmc.plugin.provider.projectLangMap
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * ADR `yaml-assisted-editing`: i18n follows the consumer. A data source is consumed
 * by Artisan's runtime, so an action it carries can reference `@key`
 * (`DslText.Ref` → `{i18n:key}` → `ActionExecutor.resolveText`), resolved against
 * the project's lang table at execution time.
 */
class ModuleActionsLangTest {

    private fun runtime(id: String, langMaps: Map<String, Map<String, String>>, defaultLang: String = "fr") =
        RuntimeProject(
            projectId = id,
            defaultLang = defaultLang,
            languages = langMaps.keys.toList(),
            langMaps = langMaps,
        )

    @Test
    fun `resolves the project's translations for the requested language`() {
        val runtimes = listOf(
            runtime("boutique_shop", mapOf("fr" to mapOf("shop.bought" to "Acheté !"), "en" to mapOf("shop.bought" to "Bought!"))),
        )
        assertEquals("Bought!", projectLangMap(runtimes, "boutique_shop", "en")["shop.bought"])
    }

    /** Deterministic fallback: the default language fills missing keys. */
    @Test
    fun `falls back to the default language for missing keys`() {
        val runtimes = listOf(
            runtime("boutique_shop", mapOf("fr" to mapOf("shop.bought" to "Acheté !"), "en" to mapOf())),
        )
        assertEquals("Acheté !", projectLangMap(runtimes, "boutique_shop", "en")["shop.bought"])
    }

    /** Without a project (or with an unknown one), no table: the text stays literal. */
    @Test
    fun `is empty without a resolvable project`() {
        val runtimes = listOf(runtime("boutique_shop", mapOf("fr" to mapOf("k" to "v"))))
        assertEquals(emptyMap(), projectLangMap(runtimes, null, "fr"))
        assertEquals(emptyMap(), projectLangMap(runtimes, "inconnu", "fr"))
        assertEquals(emptyMap(), projectLangMap(emptyList(), "boutique_shop", "fr"))
    }
}
