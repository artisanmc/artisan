package net.artisanmc.plugin.model

/**
 * A localized text: either a reference into the lang map (`key`) or an inline
 * literal (`literal`, the project's default-language text shipped directly in
 * the menu YAML by the hybrid export policy — untranslated fields inline).
 *
 * Resolution order: `literal` wins when non-null; otherwise `key` is looked up
 * in the active lang map; a miss resolves to `""` (never echo the raw key).
 */
data class LText(val key: String = "", val literal: String? = null)
