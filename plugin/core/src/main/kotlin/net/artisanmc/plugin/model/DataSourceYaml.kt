package net.artisanmc.plugin.model

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.annotation.JsonProperty

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
 *  source shipped in its files. */
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
