package net.artisanmc.plugin.model

/**
 * A localized text reference.
 *
 * `key` is the bare i18n key (without the `{i18n:...}` wrapper).
 *
 * For legacy compatibility, a literal title string (not wrapped in `{i18n:...}`)
 * is also stored here with the literal text as the `key`. The [net.artisanmc.plugin.engine.MenuTitleParser]
 * normalises both forms when ingesting YAML; the title compiler (Task 18) resolves
 * the key against the active language map with the same fallback semantics as the
 * legacy `BundleMenu.resolveTitle(lang)`.
 */
data class LText(val key: String)
