package net.artisanmc.plugin

import net.artisanmc.plugin.model.ProjectBundle
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

    private fun bundle(id: String, langMaps: Map<String, Map<String, String>>, defaultLang: String = "fr") =
        ProjectBundle(
            projectId = id,
            defaultLang = defaultLang,
            languages = langMaps.keys.toList(),
            menus = emptyList(),
            commands = emptyList(),
            dialogs = emptyList(),
            langMaps = langMaps,
        )

    @Test
    fun `resolves the project's translations for the requested language`() {
        val bundles = listOf(
            bundle("boutique_shop", mapOf("fr" to mapOf("shop.bought" to "Acheté !"), "en" to mapOf("shop.bought" to "Bought!"))),
        )
        assertEquals("Bought!", projectLangMap(bundles, "boutique_shop", "en")["shop.bought"])
    }

    /** Deterministic fallback: the default language fills missing keys. */
    @Test
    fun `falls back to the default language for missing keys`() {
        val bundles = listOf(
            bundle("boutique_shop", mapOf("fr" to mapOf("shop.bought" to "Acheté !"), "en" to mapOf())),
        )
        assertEquals("Acheté !", projectLangMap(bundles, "boutique_shop", "en")["shop.bought"])
    }

    /** Without a project (or with an unknown one), no table: the text stays literal. */
    @Test
    fun `is empty without a resolvable project`() {
        val bundles = listOf(bundle("boutique_shop", mapOf("fr" to mapOf("k" to "v"))))
        assertEquals(emptyMap(), projectLangMap(bundles, null, "fr"))
        assertEquals(emptyMap(), projectLangMap(bundles, "inconnu", "fr"))
        assertEquals(emptyMap(), projectLangMap(emptyList(), "boutique_shop", "fr"))
    }
}
