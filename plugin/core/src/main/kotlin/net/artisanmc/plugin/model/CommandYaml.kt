package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties

@JsonIgnoreProperties(ignoreUnknown = true)
data class CommandYaml(
    val schema: String = "",
    override val id: String = "",
    val name: String = "",
    val aliases: List<String> = emptyList(),
    val permission: String? = null,
    /** A bare string (every language) or `{lang: text}`. */
    val description: LocalizedText? = null,
    /** False: the command is not registered; nothing is deleted. */
    val enabled: Boolean = true,
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
    /** Typed after the name, before the arguments: `/ah sell 100`. */
    val subcommands:  List<SubcommandYaml> = emptyList(),
) : RuntimeDocument {
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

/**
 * A node of `subcommands`, at any depth: a command of its own, reached by its [name] or an
 * alias after its parent's. Without [actions] it shows its sub-commands' usage.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class SubcommandYaml(
    val name: String = "",
    val aliases: List<String> = emptyList(),
    /** Checked after the parent's: a sub-command never widens access. */
    val permission: String? = null,
    val description: LocalizedText? = null,
    /** False: the sub-command does not exist; its name falls through to the parent's arguments. */
    val enabled: Boolean = true,
    val arguments: List<Map<String, Any>> = emptyList(),
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions: Any? = null,
    val fallback: Any? = null,
    val cooldown: CooldownYaml? = null,
    val subcommands: List<SubcommandYaml> = emptyList(),
)
