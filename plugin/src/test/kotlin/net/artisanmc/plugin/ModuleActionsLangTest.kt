package net.artisanmc.plugin

import net.artisanmc.plugin.model.ProjectBundle
import net.artisanmc.plugin.provider.projectLangMap
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * ADR `yaml-assisted-editing` ④ — l'i18n suit le consommateur : une source de
 * données est consommée par le runtime d'Artisan, donc une action qu'elle porte
 * peut référencer `@clé`. La plomberie DSL existait déjà
 * (`DslText.Ref` → `{i18n:clé}` → `ActionExecutor.resolveText`) ; ce qui
 * manquait, c'est la table de langue du project au moment de l'exécution.
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

    /** Repli déterministe : la langue par défaut comble les clés manquantes. */
    @Test
    fun `falls back to the default language for missing keys`() {
        val bundles = listOf(
            bundle("boutique_shop", mapOf("fr" to mapOf("shop.bought" to "Acheté !"), "en" to mapOf())),
        )
        assertEquals("Acheté !", projectLangMap(bundles, "boutique_shop", "en")["shop.bought"])
    }

    /** Sans project (ou project inconnu), pas de table : le texte reste littéral. */
    @Test
    fun `is empty without a resolvable project`() {
        val bundles = listOf(bundle("boutique_shop", mapOf("fr" to mapOf("k" to "v"))))
        assertEquals(emptyMap(), projectLangMap(bundles, null, "fr"))
        assertEquals(emptyMap(), projectLangMap(bundles, "inconnu", "fr"))
        assertEquals(emptyMap(), projectLangMap(emptyList(), "boutique_shop", "fr"))
    }
}
