package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import net.artisanmc.plugin.engine.CompiledAppearance
import net.artisanmc.plugin.engine.MenuTitleParser

@Suppress("UNCHECKED_CAST")
internal fun extractFromSteps(steps: List<Map<String, Any>>): List<Map<String, Any>> =
    steps.mapNotNull { step ->
        if (step["kind"] == "action") step["action"] as? Map<String, Any> else null
    }

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestYaml(
    val schema: String = "",
    @JsonProperty("project_id") val projectId: String = "",
    @JsonProperty("default_lang") val defaultLang: String = "en",
    val languages: List<String> = emptyList(),
    val files: ManifestFiles = ManifestFiles(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestFiles(
    val menus: List<String> = emptyList(),
    val commands: List<String> = emptyList(),
    val dialogs: List<String> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ContextInputYaml(
    val name: String = "",
    val type: String = "string",
    val default: String? = null,
    /** ConnectorBinding canonique ({ref, params?, filter?, sort?, limit?}) — consommé en Phase B. */
    val source: Map<String, Any> = emptyMap(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class IteratesYaml(val source: String = "", val alias: String = "")

/**
 * Placement mode — the hand-authored alternative to [IteratesYaml] pagination.
 * Instead of auto-filling a slot range in source order, the admin pins specific
 * rows of a **static** data source (matched by [keyField]) to explicit page+slot.
 * Only valid on static sources; mutually exclusive with `iterates`.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class PlacesYaml(
    val source: String = "",
    val alias: String = "",
    @JsonProperty("key_field") val keyField: String = "",
    val placements: List<PlacementYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class PlacementYaml(
    val key: String = "",
    val page: Int = 0,
    val position: Int = 0,
    /** Display-only override (title/lore/material/head/count); behaviour stays from the template. */
    val override: PlacementOverrideYaml? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class PlacementOverrideYaml(
    val material: String? = null,
    val head: String? = null,
    val count: Int? = null,
    val title: String? = null,
    val lore: List<String>? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class MenuYaml(
    val schema: String = "",
    val id: String = "",
    /**
     * Title is a discriminated structure since the title composer (Task 16):
     *  - `null` / `""` → no title
     *  - `String` (legacy) → single text layer at the default position
     *  - `Map` → one layer
     *  - `List<Map>` → multiple layers
     * Parsed into a `List<MenuTitleLayer>` on [BundleMenu.title] by [net.artisanmc.plugin.engine.MenuTitleParser].
     */
    val title: Any? = null,
    val size: Int = 27,
    @JsonProperty("inventory_type") val inventoryType: String = "chest",
    val permission: String? = null,
    @JsonProperty("context_inputs") val contextInputs: List<ContextInputYaml> = emptyList(),
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
    val iterates: IteratesYaml? = null,
    val places: PlacesYaml? = null,
    val appearances: List<AppearanceYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class AppearanceYaml(
    val material: String? = null,
    val head: String? = null,
    val count: Int = 1,
    val title: String? = null,
    val lore: List<String> = emptyList(),
    val click: Map<String, ClickHandlerYaml> = emptyMap(),
    @JsonProperty("if")
    val conditions: Any? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ClickHandlerYaml(
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions:      List<Map<String, Any>> = emptyList(),
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
    val steps:        List<Map<String, Any>> = emptyList(),
) {
    fun resolvedActions(): List<Map<String, Any>> = actions.ifEmpty { extractFromSteps(steps) }
    fun resolvedFallback(): List<Map<String, Any>> = fallback.ifEmpty { emptyList() }
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class CooldownYaml(
    val id:       String  = "",
    val duration: Long    = 0,
    val scope:    String  = "player",
    val message:  String? = null,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogBodyYaml(
    val type: String = "text",
    val text: String? = null,
    val material: String? = null,
    val count: Int = 1,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogOptionYaml(
    val value: String = "",
    val label: String = "",
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogInputYaml(
    val id: String = "",
    val type: String = "",
    val label: String = "",
    val default: String = "",
    val min: Double = 0.0,
    val max: Double = 100.0,
    @JsonProperty("max_length") val maxLength: Int = 32,
    val options: List<DialogOptionYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogButtonYaml(
    val id: String = "",
    val label: String = "",
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions: List<Map<String, Any>> = emptyList(),
    val fallback: List<Map<String, Any>> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DialogYaml(
    val schema: String = "",
    val id: String = "",
    val title: String = "",
    @JsonProperty("can_close_with_escape") val canCloseWithEscape: Boolean = true,
    val body: List<DialogBodyYaml> = emptyList(),
    val inputs: List<DialogInputYaml> = emptyList(),
    val buttons: List<DialogButtonYaml> = emptyList(),
)

data class BundleDialog(
    val yaml: DialogYaml,
    val langMaps: Map<String, Map<String, String>>,
    /** Fallback language used when the player's locale isn't shipped by the pack. See [BundleMenu.defaultLang]. */
    val defaultLang: String = "en",
) {
    val id: String get() = yaml.id

    /** Same deterministic fallback chain as [BundleMenu.langMapWithFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> =
        langMaps[lang] ?: langMaps[defaultLang] ?: emptyMap()
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class CommandYaml(
    val schema: String = "",
    val id: String = "",
    val name: String = "",
    val aliases: List<String> = emptyList(),
    val permission: String? = null,
    val description: String? = null,
    val arguments: List<Map<String, Any>> = emptyList(),
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions:      List<Map<String, Any>> = emptyList(),
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
    val steps:        List<Map<String, Any>> = emptyList(),
) {
    fun resolvedActions(): List<Map<String, Any>> = actions.ifEmpty { extractFromSteps(steps) }
}

/** Assembled result for one project — all menus plus their lang maps. */
data class ProjectBundle(
    val projectId: String,
    val defaultLang: String,
    val languages: List<String>,
    val menus: List<BundleMenu>,
    val commands: List<CommandYaml>,
    val dialogs: List<BundleDialog>,
)

/** One menu with its compiled appearances, per-language translation maps, and slot mapping. */
data class BundleMenu(
    val yaml: MenuYaml,
    val langMaps: Map<String, Map<String, String>>,
    val compiledAppearances: Map<String, List<CompiledAppearance>> = emptyMap(),
    val slotToElement: Map<Int, String> = emptyMap(),
    /**
     * Parsed title layers. The canonical representation since Task 16 of the title-composer plan.
     * Computed by [MenuTitleParser.parse] at compile time. Task 18's `TitleCompiler` consumes this list.
     */
    val title: List<MenuTitleLayer> = MenuTitleParser.parse(yaml.title),
    /**
     * Fallback language declared in the parent pack's manifest. Used when the
     * player's client locale isn't in `langMaps` so we still resolve the i18n
     * keys to *some* translation instead of leaking `{i18n:foo}` to chat.
     */
    val defaultLang: String = "en",
) {
    val id: String get() = yaml.id

    /**
     * Lang map with deterministic fallback chain — requested lang → pack default
     * → empty. Renderers should use this instead of the raw `langMaps[lang]`
     * lookup so a player on a locale not shipped by the pack still sees the
     * translated text (in the default language).
     */
    fun langMapWithFallback(lang: String): Map<String, String> =
        langMaps[lang] ?: langMaps[defaultLang] ?: emptyMap()

    /**
     * Legacy title resolver kept for backward-compat until Task 18 replaces it with `TitleCompiler.compileTitle`.
     *
     * Only handles the legacy string shape — for array-shaped titles, returns an empty string.
     */
    fun resolveTitle(lang: String): String {
        val raw = yaml.title as? String ?: return ""
        if (!raw.startsWith("{i18n:")) return raw
        val key = raw.removePrefix("{i18n:").removeSuffix("}")
        return langMaps[lang]?.get(key) ?: raw
    }
}
