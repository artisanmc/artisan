package net.artisanmc.plugin.model


/** A Document as the runtime carries it: whatever its kind, it has the id its file gave it. */
interface RuntimeDocument {
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
data class RuntimeRawDocument(
    override val id: String,
    val kind: String,
    val schema: String,
    val projectId: String,
    val data: Map<String, Any?>,
) : RuntimeDocument {
    /** What a module receives: the mapping plus `id`, the file name. */
    fun toWire(): Map<String, Any?> = data + ("id" to id)
}

data class RuntimeDialog(
    val yaml: DialogYaml,
    val langMaps: Map<String, Map<String, String>>,
    /** Fallback language used when the player's locale isn't shipped by the project. See [net.artisanmc.plugin.engine.RuntimeMenu.defaultLang]. */
    val defaultLang: String = "en",
    /** Folder of the defining project: the namespace of its references (see [net.artisanmc.plugin.engine.RuntimeMenu.projectId]). */
    val projectId: String = "",
) : RuntimeDocument {
    override val id: String get() = yaml.id

    /** Same deterministic fallback chain as [net.artisanmc.plugin.engine.RuntimeMenu.langMapWithFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> = withLangFallback(langMaps, defaultLang, lang)
}
