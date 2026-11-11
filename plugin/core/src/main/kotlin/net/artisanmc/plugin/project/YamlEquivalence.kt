package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import net.artisanmc.plugin.model.YamlFiles

/**
 * Whether two texts of a YAML file hold the same value: style, quotes, key order, comments
 * and line endings (CRLF from a jar built on Windows) do not count. Unreadable YAML is never
 * the same. Mirrored by the editor (`lib/yamlEquivalence.ts`).
 */
object YamlEquivalence {
    private val mapper = ObjectMapper(YAMLFactory())

    fun sameValue(path: String, a: String, b: String): Boolean {
        if (a == b) return true
        if (!YamlFiles.isYaml(path)) return false
        return try {
            // ObjectNode equality ignores key order.
            mapper.readTree(a) == mapper.readTree(b)
        } catch (_: Exception) {
            false
        }
    }
}
