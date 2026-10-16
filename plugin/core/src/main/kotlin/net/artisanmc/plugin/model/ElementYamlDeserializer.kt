package net.artisanmc.plugin.model

import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.DeserializationContext
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.deser.std.StdDeserializer

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
         * Form from before ADR `element-display-and-states`: an `appearances` LIST,
         * display first. Still read, otherwise those files (nothing rewrites them:
         * an Add-on bootstrap never touches an existing project) open a menu WITHOUT
         * its items, with no error and no log.
         *
         * The current format wins as soon as one flat field is present: the list is
         * a leftover, not an alternative. The editor rewrites the current format on
         * the first save.
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
