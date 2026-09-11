package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonAlias
import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.annotation.JsonDeserialize
import com.fasterxml.jackson.databind.deser.std.StdDeserializer
import net.artisanmc.plugin.engine.CompiledAppearance
import net.artisanmc.plugin.engine.MenuTitleParser

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
    val templates: List<String> = emptyList(),
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
    // the Item template only (CONTEXT.md "Placement"; editor stopped authoring
    // overrides 2026-07-16, runtime support dropped with the data-sources epic).
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

/**
 * The Element's own keys — everything else at the element level is a display
 * field. Kept in ONE place and locked against the appearance field set by
 * `testdata/element-structural-keys.json`, so an appearance field that would
 * shadow a structural key fails a test instead of silently winning.
 */
val ELEMENT_STRUCTURAL_KEYS = setOf("id", "positions", "iterates", "places", "states", "tags")

/**
 * Reads the flat element form: the structural keys become the element's own
 * fields, and the whole node is handed to [AppearanceYaml] for the display —
 * it ignores unknown properties, so the structural keys around it fall away.
 */
class ElementYamlDeserializer : StdDeserializer<ElementYaml>(ElementYaml::class.java) {
    override fun deserialize(p: JsonParser, ctxt: DeserializationContext): ElementYaml {
        val codec = p.codec
        val node: JsonNode = codec.readTree(p)
        if (!node.isObject) return ElementYaml()
        /*
         * Forme d'avant l'ADR `element-display-and-states` : une LISTE
         * `appearances`, display en tête. On la lit encore, faute de quoi ces
         * fichiers — que rien ne réécrit, le bootstrap d'un Add-on ne retouchant
         * jamais un project existant — ouvrent un menu SANS ses items, sans une
         * erreur ni un log.
         *
         * Le format courant l'emporte dès qu'un champ à plat est présent : la
         * liste est un vestige, pas une alternative. L'éditeur réécrit au format
         * courant au premier enregistrement.
         */
        val flat = codec.treeToValue(node, AppearanceYaml::class.java)
        val legacy = node.get("appearances")
            ?.takeIf { it.isArray && flat == AppearanceYaml() }
            ?.map { codec.treeToValue(it, AppearanceYaml::class.java) }
        return ElementYaml(
            id = node.get("id")?.takeIf { !it.isNull }?.asText() ?: "",
            positions = node.get("positions")?.let { positionsOf(it) },
            iterates = node.get("iterates")?.takeIf { it.isObject }?.let {
                codec.treeToValue(it, IteratesYaml::class.java)
            },
            places = node.get("places")?.takeIf { it.isObject }?.let {
                codec.treeToValue(it, PlacesYaml::class.java)
            },
            display = legacy?.firstOrNull() ?: codec.treeToValue(node, AppearanceYaml::class.java),
            states = legacy?.drop(1)
                ?: node.get("states")?.takeIf { it.isArray }?.map {
                    codec.treeToValue(it, AppearanceYaml::class.java)
                } ?: emptyList(),
        )
    }

    /** `positions` stays untyped (int, string, or list) — [ElementYaml.positionsSpec] normalizes. */
    private fun positionsOf(node: JsonNode): Any? = when {
        node.isNull -> null
        node.isArray -> node.map { if (it.isNumber) it.asInt() else it.asText() }
        node.isNumber -> node.asInt()
        else -> node.asText()
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class AppearanceYaml(
    val item: String? = null,
    val material: String? = null,
    val head: String? = null,
    val count: Int? = null,
    val title: String? = null,
    val lore: List<String> = emptyList(),
    val click: Map<String, ClickHandlerYaml> = emptyMap(),
    @JsonProperty("if")
    val conditions: Any? = null,
    // ── advanced details, all applied by [net.artisanmc.plugin.render.ItemDetails] ──
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
    /** Action DSL string (Phase 2) — compiled to a Step tree by [net.artisanmc.plugin.render.DialogRenderer]. */
    val actions: String = "",
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
    /** Fallback language used when the player's locale isn't shipped by the project. See [BundleMenu.defaultLang]. */
    val defaultLang: String = "en",
) {
    val id: String get() = yaml.id

    /** Same deterministic fallback chain as [BundleMenu.langMapWithFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> =
        langMaps[defaultLang].orEmpty() + langMaps[lang].orEmpty()
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
    /** Canonical form: an Action DSL string. Legacy form: a flat action-map
     *  list (the pre-DSL wire). Disambiguated by runtime type — see [dsl] and
     *  [legacyActions]. */
    val actions:      Any? = null,
    val fallback:     List<Map<String, Any>> = emptyList(),
    val cooldown:     CooldownYaml? = null,
    /** Legacy spelling of the Action DSL string (`actions` is canonical). */
    val steps:        String = "",
) {
    /** The Action DSL string: canonical `actions` (string form) or legacy `steps`. */
    val dsl: String get() = (actions as? String) ?: steps

    /** The legacy flat action-map list (old `actions:` wire), when present. */
    @Suppress("UNCHECKED_CAST")
    val legacyActions: List<Map<String, Any>>
        get() = (actions as? List<Map<String, Any>>) ?: emptyList()
}

/**
 * One declared field of a `data/v1` Project source. The editor denormalizes its
 * Data models at export, so `kind` is always concrete here (never a model ref):
 * string | number | integer | boolean | ltext | item | list | object.
 * Cf. ADR project-sources-and-data-models + docs/schema/data/v1.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class DataFieldYaml(
    val name: String = "",
    val kind: String = "string",
    /** Element type when kind=list; value type when kind=map (its `name` is unused). */
    val of: DataFieldYaml? = null,
    /** Nested fields when kind=object. */
    val fields: List<DataFieldYaml> = emptyList(),
    /** Allowed values when kind=enum (edit-time closedness only — runtime passthrough). */
    val values: List<String> = emptyList(),
    /** Discriminant field name when kind=union. */
    val tag: String? = null,
    /** Data variants when kind=union (ADR composable-data-models). */
    val variants: List<DataVariantYaml> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class DataVariantYaml(
    val name: String = "",
    val fields: List<DataFieldYaml> = emptyList(),
)

/** Parsed `data/<id>.yaml` (or a per-row dir's `_source.yaml`) — a Project
 *  source shipped in the Bundle. */
@JsonIgnoreProperties(ignoreUnknown = true)
data class DataSourceYaml(
    val schema: String = "",
    val id: String = "",
    val shape: String = "table",
    @JsonProperty("key_field") val keyField: String? = null,
    val fields: List<DataFieldYaml> = emptyList(),
    val rows: List<Map<String, Any?>> = emptyList(),
    val value: Map<String, Any?> = emptyMap(),
    /** Row-file order for per-row granularity dirs (ADR composable-data-models §2). */
    val order: List<String> = emptyList(),
    /**
     * Model ref (`ns:id` or a models/ file id) — schema resolved at load per
     * ADR bare-data-files ① when `fields` is absent.
     */
    val model: String? = null,
)

/**
 * A Project source with its project's lang maps. ltext field values travel as
 * i18n keys; [resolved] localizes them for the viewer's language at bind time
 * (requested lang → project default → raw key, same per-key chain as menus).
 */
data class BundleDataSource(
    val yaml: DataSourceYaml,
    val langMaps: Map<String, Map<String, String>>,
    val defaultLang: String = "en",
) {
    val id: String get() = yaml.id

    fun langMapWithFallback(lang: String): Map<String, String> =
        langMaps[defaultLang].orEmpty() + langMaps[lang].orEmpty()

    /** Table → localized rows (List<Map>); config → the localized value object (Map). */
    fun resolved(lang: String): Any {
        val map = langMapWithFallback(lang)
        val sourceKey = yaml.id.trim().lowercase()
        if (yaml.shape == "config") return localizeObject(yaml.value, yaml.fields, map, "sources.$sourceKey")
        // Row addresses key on the Row key value (lowercased, positional
        // fallback on empty/duplicate) — mirror of the editor's key-site
        // visitor (ADR bare-data-files ④).
        val keyField = yaml.keyField ?: "id"
        val counts = HashMap<String, Int>()
        for (r in yaml.rows) {
            val v = rowKeyValue(r, keyField)
            if (v.isNotEmpty()) counts[v] = (counts[v] ?: 0) + 1
        }
        return yaml.rows.mapIndexed { i, r ->
            val v = rowKeyValue(r, keyField)
            val rowKey = if (v.isNotEmpty() && counts[v] == 1) v else "row_${i + 1}"
            localizeObject(r, yaml.fields, map, "sources.$sourceKey.$rowKey")
        }
    }

    private fun rowKeyValue(row: Map<String, Any?>, keyField: String): String = when (val raw = row[keyField]) {
        is String -> raw.trim().lowercase()
        is Number -> raw.toString().trim().lowercase()
        else -> ""
    }

    private fun localizeObject(
        obj: Map<String, Any?>,
        fields: List<DataFieldYaml>,
        lang: Map<String, String>,
        base: String,
    ): Map<String, Any?> {
        val byName = fields.associateBy { it.name }
        return obj.mapValues { (k, v) -> localizeValue(v, byName[k], lang, "$base.${k.lowercase()}") }
    }

    private fun localizeValue(v: Any?, field: DataFieldYaml?, lang: Map<String, String>, base: String): Any? = when {
        field == null -> v
        // Explicit key wins (legacy form); then the canonical ADDRESS (bare
        // form — the value is the default language's literal); else literal.
        field.kind == "ltext" -> (v as? String)?.let { lang[it] ?: lang[base] ?: it } ?: v
        field.kind == "list" && v is List<*> -> v.mapIndexed { i, el ->
            localizeValue(el, field.of, lang, if (i == 0) base else "${base}_${i + 1}")
        }
        field.kind == "object" && v is Map<*, *> ->
            localizeObjectAt(v, field.fields, lang, base)
        // map: every value shares the `of` type.
        field.kind == "map" && v is Map<*, *> ->
            v.entries.associate { it.key.toString() to localizeValue(it.value, field.of, lang, "$base.${it.key.toString().lowercase()}") }
        // union: pick the active variant by the tag carried in the value, then
        // localize its fields (the tag itself passes through untouched).
        field.kind == "union" && v is Map<*, *> -> {
            val obj = v.entries.associate { it.key.toString() to it.value }
            val variant = field.variants.find { it.name == obj[field.tag ?: "type"] }
            if (variant == null) obj else localizeObjectAt(v, variant.fields, lang, base)
        }
        else -> v
    }

    /** Like [localizeObject] but the base is the FIELD's address (nested object). */
    private fun localizeObjectAt(
        v: Map<*, *>,
        fields: List<DataFieldYaml>,
        lang: Map<String, String>,
        base: String,
    ): Map<String, Any?> {
        val obj = v.entries.associate { it.key.toString() to it.value }
        val byName = fields.associateBy { it.name }
        return obj.mapValues { (k, value) -> localizeValue(value, byName[k], lang, "$base.${k.lowercase()}") }
    }
}

/** Assembled result for one project — all menus plus their lang maps. */
data class ProjectBundle(
    val projectId: String,
    val defaultLang: String,
    val languages: List<String>,
    val menus: List<BundleMenu>,
    val commands: List<CommandYaml>,
    val dialogs: List<BundleDialog>,
    val dataSources: List<BundleDataSource> = emptyList(),
    /**
     * Traductions du project (`lang/<code>.yaml`). Portées ici en plus des
     * copies par menu/dialog : une action de data source exécutée par un module
     * n'a ni menu ni dialog en contexte, mais doit pouvoir résoudre `@clé`
     * (ADR yaml-assisted-editing ④ — l'i18n suit le consommateur).
     */
    val langMaps: Map<String, Map<String, String>> = emptyMap(),
) {
    /** Même chaîne de repli déterministe que [BundleMenu.langMapWithFallback]. */
    fun langMapWithFallback(lang: String): Map<String, String> =
        langMaps[defaultLang].orEmpty() + langMaps[lang].orEmpty()
}

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
    val title: List<MenuTitleLayer> = MenuTitleParser.parse(yaml.title, yaml.id),
    /**
     * Fallback language declared in the parent project's manifest. Used when the
     * player's client locale isn't in `langMaps` so we still resolve the i18n
     * keys to *some* translation instead of leaking `{i18n:foo}` to chat.
     */
    val defaultLang: String = "en",
) {
    val id: String get() = yaml.id

    /**
     * Lang map with deterministic PER-KEY fallback chain — requested lang →
     * project default → empty. The editor only writes a key into a non-default
     * lang file when the user translated it, so the default map fills the
     * requested lang's gaps; a whole-map fallback would leak raw i18n keys
     * in-game for every untranslated key.
     */
    fun langMapWithFallback(lang: String): Map<String, String> =
        langMaps[defaultLang].orEmpty() + langMaps[lang].orEmpty()

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
