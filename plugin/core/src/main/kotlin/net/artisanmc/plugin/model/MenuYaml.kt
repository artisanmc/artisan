package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonAlias
import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.databind.annotation.JsonDeserialize

@JsonIgnoreProperties(ignoreUnknown = true)
data class ContextInputYaml(
    val name: String = "",
    val type: String = "string",
    val default: String? = null,
    /** Canonical ConnectorBinding (`{ref, params?, filter?, sort?, limit?}`). */
    val source: Map<String, Any> = emptyMap(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class IteratesYaml(
    val source: String = "",
    val alias: String = "",
    /** Item template ref (templates/<id>.yaml) — alias + appearances come from
     *  the template, resolved at load by [net.artisanmc.plugin.yaml.ProjectReader]. */
    val template: String? = null,
)

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
    /** Item template ref — alias/key_field/appearances come from the template. */
    val template: String? = null,
    val placements: List<PlacementYaml> = emptyList(),
)

/**
 * `templates/<id>.yaml` (template/v1) — a named view over one data source: THE
 * row template (appearances + click), referenced by elements via
 * `iterates.template` / `places.template` and resolved into effective elements
 * at load ([net.artisanmc.plugin.yaml.ProjectReader]). Hand-editing a template
 * file + reload propagates to every consuming menu.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class TemplateYaml(
    val schema: String = "",
    val id: String = "",
    val name: String = "",
    val source: String = "",
    val alias: String = "",
    @JsonProperty("key_field") val keyField: String = "",
    val appearances: List<AppearanceYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class PlacementYaml(
    val key: String = "",
    val page: Int = 0,
    val position: Int = 0,
    // No per-placement override: how a placed row looks and behaves comes from
    // the Item template only (CONTEXT.md "Placement").
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class MenuYaml(
    val schema: String = "",
    val id: String = "",
    /**
     * Title is a discriminated structure:
     *  - `null` / `""` → no title
     *  - `String` (legacy) → single text layer at the default position
     *  - `Map` → one layer
     *  - `List<Map>` → multiple layers
     * Parsed into a `List<MenuTitleLayer>` on [BundleMenu.title] by [net.artisanmc.plugin.engine.MenuTitleParser].
     */
    val title: Any? = null,
    val size: Int = 27,
    @JsonProperty("inventory_type") val inventoryType: String = "chest",
    /** `visible` (default) | `hidden`: see [net.artisanmc.plugin.render.PlayerInventoryMode]. */
    @JsonProperty("player_inventory") val playerInventory: String = "visible",
    /** `false`: transparent chest (the pack makes generic_54.png invisible), see VanillaGuiTitle. */
    @JsonProperty("vanilla_texture") val vanillaTexture: Boolean = true,
    val permission: String? = null,
    // Canonical wire name: `inputs`; `context_inputs` is the legacy spelling.
    @JsonProperty("inputs")
    @JsonAlias("context_inputs")
    val contextInputs: List<ContextInputYaml> = emptyList(),
    /** Canonical form: flat element list, document order = stacking order
     *  (later wins per slot). */
    val elements: List<ElementYaml> = emptyList(),
    /** Legacy form: layers wrapping (id/name carry no runtime behavior). */
    val layers: List<LayerYaml> = emptyList(),
) {
    /** Every element in stacking order, whichever wire form carried them. */
    val allElements: List<ElementYaml> get() = layers.flatMap { it.elements } + elements
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class LayerYaml(
    val id: String = "",
    val name: String = "",
    val elements: List<ElementYaml> = emptyList(),
)

/**
 * One placed thing in a menu. Its **display** appearance is written FLAT on the
 * element (`material:`, `title:`, `click:` …) and its guarded **states** under
 * `states:` — cf. ADR `element-display-and-states`. The element's own keys are
 * exactly [ELEMENT_STRUCTURAL_KEYS]; everything else at this level is a field of
 * the display, which is why [ElementYamlDeserializer] can hand the whole node to
 * [AppearanceYaml] and let it ignore what isn't its own.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonDeserialize(using = ElementYamlDeserializer::class)
data class ElementYaml(
    val id: String = "",
    /** Bare int, range/comma string ("11-14", "0,8,18-20"), or a YAML list of
     *  both — normalized by [positionsSpec]. */
    val positions: Any? = null,
    val iterates: IteratesYaml? = null,
    val places: PlacesYaml? = null,
    /** Rendered when no state matches — an Element always has one. */
    val display: AppearanceYaml = AppearanceYaml(),
    /** Guarded alternatives, tried in order BEFORE the display. Each is a whole
     *  appearance: what it omits is absent, never inherited from the display. */
    val states: List<AppearanceYaml> = emptyList(),
) {
    /** Comma-joined spec string, whichever wire form carried the positions. */
    val positionsSpec: String
        get() = when (positions) {
            null -> ""
            is List<*> -> positions.joinToString(",") { it.toString() }
            else -> positions.toString()
        }
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class AppearanceYaml(
    val image: ImageButtonYaml? = null,
    val extends: Any? = null,
    @JsonProperty("lore_mode") val loreMode: String? = null,
    val item: String? = null,
    val material: String? = null,
    val head: String? = null,
    val count: Int? = null,
    /** Field-local text (ADR `field-local-translations`): literal or `{lang: text}` map. */
    val title: LocalizedText? = null,
    val lore: List<LocalizedText> = emptyList(),
    /** Wire handler per click type: string (legacy DSL), `{steps}`, or keyed (map/list). */
    val click: Map<String, Any?> = emptyMap(),
    @JsonProperty("if")
    val conditions: Any? = null,
    // advanced details, all applied by [net.artisanmc.plugin.render.ItemDetails]
    /** Map `{id: level}` (canonical) or list `[{id, level}]`. Loose ids tolerated. */
    val enchants: Any? = null,
    /** Glint with no real enchantment. */
    val enchanted: Boolean = false,
    @JsonProperty("custom_model_data")
    val customModelData: String? = null,
    val unbreakable: Boolean = false,
    /** Hidden tooltip sections (short or Bukkit ItemFlag spelling). */
    val hide: List<String> = emptyList(),
    /** `#rrggbb` tint — leather armor / potion. Ignored elsewhere. */
    val color: String? = null,
    /** Raw SNBT, applied last. Best-effort. */
    val nbt: String? = null,
)

data class ImageButtonYaml(
    val asset: String = "", val fit: String = "contain",
    @JsonProperty("offset_x") val offsetX: Int = 0,
    @JsonProperty("offset_y") val offsetY: Int = 0,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class ClickHandlerYaml(
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions:      List<Map<String, Any>> = emptyList(),
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
    /** The Action DSL string (actions + if/else), compiled to a Step tree by
     *  [BundleCompiler]. Canonical wire is the collapsed form (the handler IS
     *  the DSL string — see [fromDsl]); `{steps: "<dsl>"}` is the legacy wrap. */
    val steps:        String = "",
) {
    companion object {
        /** Canonical collapsed form: `click.left: "<dsl>"` binds the scalar here. */
        @JvmStatic
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        fun fromDsl(dsl: String): ClickHandlerYaml = ClickHandlerYaml(steps = dsl)
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class CooldownYaml(
    val id:       String  = "",
    val duration: Long    = 0,
    val scope:    String  = "player",
    val message:  String? = null,
)
