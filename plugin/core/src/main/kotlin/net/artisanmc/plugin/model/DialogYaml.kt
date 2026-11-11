package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogBodyYaml(
    val type: String = "text",
    val text: LocalizedText? = null,
    val material: String? = null,
    val count: Int = 1,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogOptionYaml(
    val value: String = "",
    val label: LocalizedText? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogInputYaml(
    val id: String = "",
    val type: String = "",
    val label: LocalizedText? = null,
    val default: String = "",
    val min: Double = 0.0,
    val max: Double = 100.0,
    @JsonProperty("max_length") val maxLength: Int = 32,
    val options: List<DialogOptionYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogButtonYaml(
    val id: String = "",
    val label: LocalizedText? = null,
    val requirements: List<Map<String, Any>> = emptyList(),
    /** Wire handler: string (legacy DSL), `{steps}`, or keyed (map/list); see ADR structured-action-wire. */
    val actions: Any? = null,
    val fallback: Any? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogYaml(
    val schema: String = "",
    val id: String = "",
    val title: LocalizedText? = null,
    @JsonProperty("can_close_with_escape") val canCloseWithEscape: Boolean = true,
    val body: List<DialogBodyYaml> = emptyList(),
    val inputs: List<DialogInputYaml> = emptyList(),
    val buttons: List<DialogButtonYaml> = emptyList(),
)
