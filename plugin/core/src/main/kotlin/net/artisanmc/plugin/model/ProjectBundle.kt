package net.artisanmc.plugin.model

import net.artisanmc.plugin.engine.CompiledAppearance
import net.artisanmc.plugin.engine.MenuTitleParser

/** A Document as the runtime carries it: whatever its kind, it has the id its file gave it. */
interface BundleDocument {
    val id: String
}

/**
 * A Document of a kind the core has no reader for — one a module registered
 * through `api.documentKinds`. The file's YAML mapping as parsed, untouched: the
 * owning module reads it back through `ProjectContentApi.documents(projectId,
 * kind)` and decides what it means (ADR `extensible-document-kinds`, W6).
 *
 * @property data the file's mapping, `schema` included, without the `id`.
 */
data class BundleRawDocument(
    override val id: String,
    val kind: String,
    val schema: String,
    val projectId: String,
    val data: Map<String, Any?>,
) : BundleDocument {
    /** What a module receives: the mapping plus `id`, the file name. */
    fun toWire(): Map<String, Any?> = data + ("id" to id)
}

/** Assembled result for one project — its Documents by kind plus their lang maps. */
data class ProjectBundle(
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
    val documents: Map<String, List<BundleDocument>> = emptyMap(),
    val dataSources: List<BundleDataSource> = emptyList(),
    /**
     * The project's translations (`lang/<code>.yaml`). Carried here on top of the
     * per-menu/dialog copies: a data-source action run by a module has no menu or
     * dialog in context but must still resolve `@key` (ADR yaml-assisted-editing:
     * i18n follows the consumer).
     */
    val langMaps: Map<String, Map<String, String>> = emptyMap(),
) {
    /** Typed read façade over [documents] for the core kinds — the one cast point. */
    val menus: List<BundleMenu> get() = documentsOf(DocumentKinds.MENU.kind)
    val commands: List<CommandYaml> get() = documentsOf(DocumentKinds.COMMAND.kind)
    val dialogs: List<BundleDialog> get() = documentsOf(DocumentKinds.DIALOG.kind)

    /** The Documents of one kind, typed by the caller — `[]` when the project holds none. */
    inline fun <reified T : BundleDocument> documentsOf(kind: String): List<T> =
        documents[kind].orEmpty().map { it as T }

    /** Same deterministic fallback chain as [BundleMenu.langMapWithFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> = withLangFallback(langMaps, defaultLang, lang)
}

/** One menu with its compiled appearances, per-language translation maps, and slot mapping. */
data class BundleMenu(
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
) : BundleDocument {
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

data class BundleDialog(
    val yaml: DialogYaml,
    val langMaps: Map<String, Map<String, String>>,
    /** Fallback language used when the player's locale isn't shipped by the project. See [BundleMenu.defaultLang]. */
    val defaultLang: String = "en",
    /** Folder of the defining project: the namespace of its references (see [BundleMenu.projectId]). */
    val projectId: String = "",
) : BundleDocument {
    override val id: String get() = yaml.id

    /** Same deterministic fallback chain as [BundleMenu.langMapWithFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> = withLangFallback(langMaps, defaultLang, lang)
}
