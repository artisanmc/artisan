package net.artisanmc.plugin.model

/**
 * THE lang map of one language, with the deterministic PER-KEY fallback chain:
 * requested lang → project default → empty. The editor only writes a key into a
 * non-default lang file when the user translated it, so the default map fills
 * the requested lang's gaps; a whole-map fallback would leak raw i18n keys
 * in-game for every untranslated key.
 *
 * The one implementation behind every `langMapWithFallback` of the runtime
 * model ([RuntimeProject], [RuntimeMenu], [RuntimeDialog], [RuntimeDataSource]).
 */
fun withLangFallback(
    langMaps: Map<String, Map<String, String>>,
    defaultLang: String,
    lang: String,
): Map<String, String> = langMaps[defaultLang].orEmpty() + langMaps[lang].orEmpty()
