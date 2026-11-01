package net.artisanmc.plugin.engine

import net.artisanmc.plugin.model.CommandYaml
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.model.RuntimeDataSource
import net.artisanmc.plugin.model.RuntimeDialog
import net.artisanmc.plugin.model.RuntimeDocument
import net.artisanmc.plugin.model.withLangFallback

/** Assembled result for one project — its Documents by kind plus their lang maps. */
data class RuntimeProject(
    val projectId: String,
    val defaultLang: String,
    val languages: List<String>,
    /**
     * The project's Documents, keyed by [DocumentKind.kind] (ADR
     * `extensible-document-kinds`, decision 10). The only store: [menus],
     * [commands] and [dialogs] are typed views of it, and a kind the core does
     * not know sits here untouched for the module that registered it
     * ([documentsOf]).
     */
    val documents: Map<String, List<RuntimeDocument>> = emptyMap(),
    val dataSources: List<RuntimeDataSource> = emptyList(),
    /**
     * The project's translations (`lang/<code>.yaml`). Carried here on top of the
     * per-menu/dialog copies: a data-source action run by a module has no menu or
     * dialog in context but must still resolve `@key` (ADR yaml-assisted-editing:
     * i18n follows the consumer).
     */
    val langMaps: Map<String, Map<String, String>> = emptyMap(),
    /**
     * The menus and dialogs of the module's variants (design `variantes-modules`), by variant
     * name then kind, each under the id of the file it replaces (or its own). Empty without
     * `variants.yml`.
     */
    val variants: Map<String, Map<String, List<RuntimeDocument>>> = emptyMap(),
    /** The display rules of `variants.yml`, in order: which variant a player gets. */
    val variantRules: List<VariantRule> = emptyList(),
) {
    /** The Document [id] of [kind] in [variant], or `null` when that variant does not have it. */
    fun variantDocument(variant: String, kind: String, id: String): RuntimeDocument? =
        variants[variant]?.get(kind)?.firstOrNull { it.id == id }

    /** Typed read façade over [documents] for the core kinds — the one cast point. */
    val menus: List<RuntimeMenu> get() = documentsOf(DocumentKinds.MENU.kind)
    val commands: List<CommandYaml> get() = documentsOf(DocumentKinds.COMMAND.kind)
    val dialogs: List<RuntimeDialog> get() = documentsOf(DocumentKinds.DIALOG.kind)

    /** The Documents of one kind, typed by the caller — `[]` when the project holds none. */
    inline fun <reified T : RuntimeDocument> documentsOf(kind: String): List<T> =
        documents[kind].orEmpty().map { it as T }

    /** Same deterministic fallback chain as [RuntimeMenu.langMapWithFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> = withLangFallback(langMaps, defaultLang, lang)
}

/** One menu with its compiled appearances, per-language translation maps, and slot mapping. */
data class RuntimeMenu(
    val yaml: MenuYaml,
    val langMaps: Map<String, Map<String, String>>,
    val compiledAppearances: Map<String, List<CompiledAppearance>> = emptyMap(),
    val slotToElement: Map<Int, String> = emptyMap(),
    /**
     * Parsed title layers, the canonical title representation. Computed by
     * [MenuTitleParser.parse] at compile time and consumed by `TitleCompiler`.
     */
    val title: List<MenuTitleLayer> = MenuTitleParser.parse(yaml.title, yaml.id),
    /**
     * Fallback language declared in the parent project's manifest. Used when the
     * player's client locale isn't in `langMaps` so we still resolve the i18n
     * keys to *some* translation instead of leaking `{i18n:foo}` to chat.
     */
    val defaultLang: String = "en",
    /**
     * Folder of the defining project, the namespace of its references: a bare
     * `open_menu` fired from this menu resolves here first (`DocumentTable`).
     * Empty for a menu without a project (relayed draft, tests).
     */
    val projectId: String = "",
    /** From the project manifest — see [ManifestYaml.loreMaxWidth]. */
    val loreMaxWidth: Int = 0,
    /** From the project manifest — see [ManifestYaml.escapeGoesBack]. */
    val escapeGoesBack: Boolean = false,
) : RuntimeDocument {
    override val id: String get() = yaml.id

    /** Lang map with the per-key fallback chain of [withLangFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> = withLangFallback(langMaps, defaultLang, lang)

    /**
     * Legacy title resolver. Only handles the legacy string shape: returns an empty
     * string for layered titles. Reads `langMaps[lang]` only, WITHOUT the
     * default-lang fallback of [langMapWithFallback] (kept as is: tests only).
     */
    fun resolveTitle(lang: String): String {
        val raw = yaml.title as? String ?: return ""
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMaps[lang]?.get(key) ?: raw
    }
}
