package gg.interfaze.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestYaml(
    val schema: String = "",
    @JsonProperty("pack_id") val packId: String = "",
    @JsonProperty("default_lang") val defaultLang: String = "en",
    val languages: List<String> = emptyList(),
    val files: ManifestFiles = ManifestFiles(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestFiles(
    val menus: List<String> = emptyList(),
    val commands: List<String> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class MenuYaml(
    val schema: String = "",
    val id: String = "",
    val title: String = "",
    val size: Int = 27,
    val permission: String? = null,
    val layers: List<LayerYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class LayerYaml(
    val id: String = "",
    val name: String = "",
    val elements: List<ElementYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ElementYaml(
    val id: String = "",
    val positions: String = "",
    val appearances: List<AppearanceYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class AppearanceYaml(
    val material: String? = null,
    val count: Int = 1,
    val title: String? = null,
    val lore: List<String> = emptyList(),
    val click: Map<String, ClickHandlerYaml> = emptyMap(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ClickHandlerYaml(
    val steps: List<Map<String, Any>> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class CommandYaml(
    val schema: String = "",
    val id: String = "",
    val name: String = "",
    val aliases: List<String> = emptyList(),
    val permission: String? = null,
    val description: String? = null,
    val arguments: List<Map<String, Any>> = emptyList(),
    val steps: List<Map<String, Any>> = emptyList(),
)

/** Assembled result for one pack — all menus plus their lang maps. */
data class PackBundle(
    val packId: String,
    val defaultLang: String,
    val languages: List<String>,
    val menus: List<BundleMenu>,
    val commands: List<CommandYaml>,
)

/** One menu with its per-language translation maps bundled in. */
data class BundleMenu(
    val yaml: MenuYaml,
    val langMaps: Map<String, Map<String, String>>,
) {
    val id: String get() = yaml.id

    /**
     * Resolves `{i18n:key}` in `yaml.title` using the given lang.
     * Falls back to the raw tag if lang has no entry.
     */
    fun resolveTitle(lang: String): String {
        val raw = yaml.title
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMaps[lang]?.get(key) ?: raw
    }
}
