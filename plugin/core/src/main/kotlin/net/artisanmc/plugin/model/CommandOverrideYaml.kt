package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonAlias
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

/**
 * `command_override/v1`: the admin's dressing of a command a module declares. Every absent
 * field keeps the module's value; deleting the document resets the command. Carries no
 * behaviour: no actions, no arguments.
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
