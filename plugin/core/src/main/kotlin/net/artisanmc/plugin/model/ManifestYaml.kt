package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule

/** A module's [ModuleFile]: `module/v1`, or the legacy `manifest/v1` with the same fields. */
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
    /** What the owner does with the module's originals (design `originaux-modules`). */
    val originals: OriginalsYaml = OriginalsYaml(),
) {
    companion object {
        private val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule()

        /** A module file's text, or null when it does not parse. */
        fun parse(text: String): ManifestYaml? = runCatching { yaml.readValue<ManifestYaml>(text) }.getOrNull()
    }
}

/** `originals:` of a module file: the shipped files the owner does not want, by path in `originals/`. */
data class OriginalsYaml(val exclude: List<String> = emptyList())
