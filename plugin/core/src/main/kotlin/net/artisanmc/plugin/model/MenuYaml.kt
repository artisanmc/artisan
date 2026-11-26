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
     * Parsed into a `List<MenuTitleLayer>` on [net.artisanmc.plugin.engine.RuntimeMenu.title] by [net.artisanmc.plugin.engine.MenuTitleParser].
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
    /**
     * Redraws the element every this many ticks while the menu stays open (`refresh_ticks`):
     * conditions, texts and placeholders again, one slot packet when the item changed. Null:
     * drawn once, at opening. Read through [refreshPeriod].
     */
    @JsonProperty("refresh_ticks") val refreshTicks: Int? = null,
) {
    /** [refreshTicks] as the runtime uses it: null when absent or not positive, never under [MIN_REFRESH_TICKS]. */
    val refreshPeriod: Int?
        get() = refreshTicks?.takeIf { it > 0 }?.coerceAtLeast(MIN_REFRESH_TICKS)

    companion object {
        /** Ten redraws a second at most: a faster period is read as this one. */
        const val MIN_REFRESH_TICKS = 2
    }

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
    /** Text drawn in the title over the element's slot rectangle (fixed elements only). */
    val label: LabelYaml? = null,
    /**
     * The look as pieces drawn bottom to top over the slot rectangle, written instead of
     * [image] and [label] (ADR `element-parts-and-sliced-images`). Read through [images] and [labels].
     */
    val parts: List<PartYaml>? = null,
    /** A component's name, or `{name, …its parameters}`: only still there when no such component was found ([MenuComponents] reads the others into [parts]). */
    val component: Any? = null,
    val extends: Any? = null,
    @JsonProperty("lore_mode") val loreMode: String? = null,
    val item: String? = null,
    val material: String? = null,
    val head: String? = null,
    val count: Int? = null,
    /** Field-local text (ADR `field-local-translations`): literal or `{lang: text}` map. */
    val title: LocalizedText? = null,
    /** Lines, or one list per language (see [LoreDeserializer]). */
    @JsonDeserialize(using = LoreDeserializer::class)
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
) {
    /** The images this look draws, bottom to top: its image pieces, else its [image]. */
    @get:com.fasterxml.jackson.annotation.JsonIgnore
    val images: List<ImageButtonYaml>
        get() = parts?.mapNotNull { it.asImage() } ?: listOfNotNull(image)

    /** The texts this look draws: its text pieces, else its [label]. */
    @get:com.fasterxml.jackson.annotation.JsonIgnore
    val labels: List<LabelYaml>
        get() = parts?.mapNotNull { it.asLabel() } ?: listOfNotNull(label)
}

/**
 * One piece of a look: an image by its name ([image], at its own size unless [fit] says
 * otherwise) or a text ([label]), placed by one of nine anchors, then shifted by the offsets.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class PartYaml(
    val image: Any? = null,
    val label: Any? = null,
    val fit: String = "native",
    val anchor: String = "center",
    val size: Int = 8,
    @JsonProperty("offset_x") val offsetX: Int = 0,
    @JsonProperty("offset_y") val offsetY: Int = 0,
) {
    fun asImage(): ImageButtonYaml? = (image as? String)?.let { ImageButtonYaml(it, fit, offsetX, offsetY, anchor) }

    fun asLabel(): LabelYaml? {
        if (image is String || label == null) return null
        val horizontal = if (anchor == "left" || anchor.endsWith("_left")) "left" else if (anchor == "right" || anchor.endsWith("_right")) "right" else "center"
        val vertical = if (anchor == "top" || anchor.startsWith("top_")) "top" else if (anchor == "bottom" || anchor.startsWith("bottom_")) "bottom" else "center"
        return LabelYaml(label, horizontal, size, offsetX, offsetY, vertical)
    }
}

/**
 * An element's label: [text] (literal, `{i18n:key}` or `{lang: text}`) placed in the
 * element's slot rectangle, centred vertically, then aligned and shifted by the offsets.
 */
data class LabelYaml(
    val text: Any? = null,
    val align: String = "center",
    val size: Int = 8,
    @JsonProperty("offset_x") val offsetX: Int = 0,
    @JsonProperty("offset_y") val offsetY: Int = 0,
    /** `top`, `center` or `bottom`: set by a text piece's anchor, never written on a `label`. */
    @com.fasterxml.jackson.annotation.JsonIgnore val valign: String = "center",
)

data class ImageButtonYaml(
    val asset: String = "", val fit: String = "contain",
    @JsonProperty("offset_x") val offsetX: Int = 0,
    @JsonProperty("offset_y") val offsetY: Int = 0,
    /** Where the image sits in the rectangle before the offsets: one of the nine anchors. */
    val anchor: String = "center",
) {
    companion object {
        val ANCHORS = setOf("center", "left", "right", "top", "bottom", "top_left", "top_right", "bottom_left", "bottom_right")
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class ClickHandlerYaml(
    val requirements: List<Map<String, Any>> = emptyList(),
    val actions:      List<Map<String, Any>> = emptyList(),
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
    /** The Action DSL string (actions + if/else), compiled to a Step tree by
     *  [MenuCompiler]. Canonical wire is the collapsed form (the handler IS
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
    /** Seconds. The schemas write `duration_seconds`; `duration` is the old spelling. */
    @JsonProperty("duration_seconds") @JsonAlias("duration")
    val duration: Long    = 0,
    val scope:    String  = "player",
    val message:  String? = null,
)
