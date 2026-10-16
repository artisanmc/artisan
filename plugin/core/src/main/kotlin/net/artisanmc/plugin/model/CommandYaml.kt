package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

@JsonIgnoreProperties(ignoreUnknown = true)
data class CommandYaml(
    val schema: String = "",
    override val id: String = "",
    val name: String = "",
    val aliases: List<String> = emptyList(),
    val permission: String? = null,
    val description: String? = null,
    val arguments: List<Map<String, Any>> = emptyList(),
    val requirements: List<Map<String, Any>> = emptyList(),
    /** Canonical form: an Action DSL string. Legacy form: a flat action-map
     *  list (the pre-DSL wire). Disambiguated by runtime type — see [dsl] and
     *  [legacyActions]. */
    val actions:      Any? = null,
    val fallback:     Any? = null,
    val cooldown:     CooldownYaml? = null,
    /** Legacy spelling of the Action DSL string (`actions` is canonical). */
    val steps:        String = "",
) : BundleDocument {
    /** The Action DSL string: canonical `actions` (string form) or legacy `steps`. */
    val dsl: String get() = (actions as? String) ?: steps

    /** Raw wire handler: `actions` (canonical) or `steps` (legacy). */
    val handler: Any? get() = actions ?: steps.ifEmpty { null }

    /**
     * The legacy flat action-map list (old `actions:` wire), when present. A
     * list whose entries carry a `type` key is the legacy `Action` shape; a
     * keyed list (`{send_message: …}`) is the new wire and is filtered out here.
     */
    @Suppress("UNCHECKED_CAST")
    val legacyActions: List<Map<String, Any>>
        get() = (actions as? List<*>)?.filterIsInstance<Map<String, Any>>()?.filter { it.containsKey("type") }
            ?: emptyList()
}
