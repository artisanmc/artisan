package net.artisanmc.plugin.model

/**
 * A localized text reference.
 *
 * `key` is the bare i18n key (without the `{i18n:...}` wrapper).
 *
 * A literal title string (not wrapped in `{i18n:...}`) is also stored here, with
 * the literal text as the `key` and [literal] set. The
 * [net.artisanmc.plugin.engine.MenuTitleParser] normalises both forms when
 * ingesting YAML.
 */
data class LText(
    val key: String,
    /**
     * True when `key` holds LITERAL text rather than an i18n key. The two
     * resolve differently: an unresolved ref renders empty (never echo a raw
     * key at a player), while a literal simply renders itself.
     */
    val literal: Boolean = false,
    /**
     * Canonical i18n ADDRESS of this title layer (`menus.<id>.title`, then
     * `_2`, `_3`…) — inline mode looks the literal up here to translate it.
     * Stamped by [net.artisanmc.plugin.engine.MenuTitleParser], which knows the
     * owning menu; mirror of the editor's `visitMenuTitleLTexts`.
     */
    val address: String? = null,
    /**
     * Field-local per-language values (ADR `field-local-translations`): a map
     * `{ lang: text }` read from a title layer's `value`. When present it wins
     * over both the literal and the address.
     */
    val localized: Map<String, String>? = null,
)
