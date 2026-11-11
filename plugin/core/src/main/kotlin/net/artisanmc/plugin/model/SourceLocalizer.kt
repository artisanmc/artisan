package net.artisanmc.plugin.model

/**
 * Localizes the values of a Project source ([DataSourceYaml]) for one language,
 * field by field, following each field's declared `kind`. A value is looked up
 * by its explicit key (legacy form), then by its canonical ADDRESS
 * (`sources.<source>.<row>.<field>…`, ADR bare-data-files), else kept literal.
 */
internal object SourceLocalizer {
    /** Table → localized rows (List<Map>); config → the localized value object (Map). */
    fun localize(yaml: DataSourceYaml, map: Map<String, String>): Any {
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
        field.kind == "item" && v is Map<*, *> -> v.entries.associate { (key, value) ->
            val name = key.toString()
            val type = when (name) {
                "title" -> DataFieldYaml(kind = "ltext")
                "lore" -> if (value is List<*>) DataFieldYaml(kind = "list", of = DataFieldYaml(kind = "ltext")) else DataFieldYaml(kind = "ltext")
                "extends" -> DataFieldYaml(kind = "item")
                else -> null
            }
            name to localizeValue(value, type, lang, "$base.$name")
        }
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
