package net.artisanmc.plugin.model

/**
 * A Project source with its project's lang maps. ltext field values travel as
 * i18n keys; [resolved] localizes them for the viewer's language at bind time
 * (requested lang → project default → raw key, same per-key chain as menus).
 */
data class BundleDataSource(
    val yaml: DataSourceYaml,
    val langMaps: Map<String, Map<String, String>>,
    val defaultLang: String = "en",
) {
    val id: String get() = yaml.id

    /** Same per-key fallback chain as [BundleMenu.langMapWithFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> = withLangFallback(langMaps, defaultLang, lang)

    /** Table → localized rows (List<Map>); config → the localized value object (Map). */
    fun resolved(lang: String): Any = SourceLocalizer.localize(yaml, langMapWithFallback(lang))
}
