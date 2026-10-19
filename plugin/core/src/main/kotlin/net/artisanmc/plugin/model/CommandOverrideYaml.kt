package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonAlias
import com.fasterxml.jackson.annotation.JsonIgnore
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

/**
 * `command_override/v1`: the admin's dressing of a command a module declares. Every absent
 * field keeps the module's value; deleting the document resets the command. Its id,
 * arguments and sub-commands stay the module's: its code reads them. [steps] replaces what
 * the command does.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class CommandOverrideYaml(
    val schema: String = "",
    /** The declared id (`attribution:open`), never changed. */
    val command: String = "",
    /** False: the command is not registered; nothing is deleted. */
    val enabled: Boolean = true,
    /** Root commands only: a child keeps its declared name. */
    val name: String? = null,
    val aliases: List<String>? = null,
    /** `""`: no permission at all. */
    val permission: String? = null,
    val description: LocalizedText? = null,
    val cooldown: OverrideCooldownYaml? = null,
    val requirements: List<Map<String, Any>> = emptyList(),
    /** Actions run when a requirement fails (Action chain, as in `command/v1`). */
    val fallback: Any? = null,
    /**
     * Replaces the module's code (Action chain, as in `command/v1`), on a root or a
     * sub-command: its parsed arguments are the chain's `{name}` values. `module_command`
     * runs the module's code from a chain.
     */
    val steps: Any? = null,
    /** The folder the document was read from: a bare menu id in [steps] resolves there. Set by the store. */
    @JsonIgnore
    val project: String? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class OverrideCooldownYaml(
    val id: String = "",
    @JsonProperty("duration_seconds") @JsonAlias("duration")
    val duration: Long = 0,
    val scope: String = "player",
    /** Shown while the cooldown runs, in the sender's language. */
    val message: LocalizedText? = null,
)
