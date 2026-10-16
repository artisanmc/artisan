package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestYaml(
    val schema: String = "",
    @JsonProperty(value = "project_id", access = JsonProperty.Access.WRITE_ONLY) val projectId: String = "",
    @JsonProperty("default_lang") val defaultLang: String = "en",
    val languages: List<String> = emptyList(),
    /**
     * Legacy `files:` block, keyed by document folder (`menus`, `commands`,
     * `dialogs`, `templates`). Merged into the folder scan, never subtracted.
     */
    val files: Map<String, List<String>> = emptyMap(),
    /** Lore lines wider than this many MC pixels wrap ([net.artisanmc.plugin.render.LoreWrap]). 0 = never. */
    @JsonProperty("lore_max_width") val loreMaxWidth: Int = 0,
    /** ESC reopens the previous screen of the stack instead of closing everything ([net.artisanmc.plugin.render.MenuListener]). */
    @JsonProperty("escape_goes_back") val escapeGoesBack: Boolean = false,
)
