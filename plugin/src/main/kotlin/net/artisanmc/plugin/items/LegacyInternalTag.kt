package net.artisanmc.plugin.items

import org.yaml.snakeyaml.DumperOptions
import org.yaml.snakeyaml.Yaml
import java.util.Base64
import java.util.zip.GZIPInputStream

/**
 * Rescue for the legacy `meta.internal` blob — base64 of a gzipped NBT compound,
 * how Bukkit used to serialize block-entity metadata (shulkers, banners,
 * spawners, heads) before the component format.
 *
 * Captures written on an older server carry one, and on a newer server those
 * bytes no longer inflate: `CraftMetaItem` logs a full `ZipException` stacktrace
 * per file and drops the block-state anyway, without ever naming the item. We
 * check the blob before Bukkit does and drop the dead key, so the load stays
 * quiet and [CapturedItemStore] can warn with the id the operator needs.
 *
 * Only a blob that cannot be read is removed — a valid one is left strictly
 * alone, so this never rewrites a healthy capture.
 */
object LegacyInternalTag {

    /**
     * The YAML with every unreadable `internal` key removed, or null when
     * there is nothing to fix (no such key, all of them readable, or the text
     * isn't parseable at all — the caller's own error path handles that).
     */
    fun stripUnreadable(text: String): String? {
        // Cheap guard: the vast majority of captures are component-format.
        if (!text.contains("internal")) return null

        val root = runCatching { Yaml().load<Any?>(text) }.getOrNull() as? MutableMap<*, *> ?: return null
        if (!prune(root)) return null

        val options = DumperOptions().apply {
            defaultFlowStyle = DumperOptions.FlowStyle.BLOCK
        }
        return runCatching { Yaml(options).dump(root) }.getOrNull()
    }

    /** Walks the tree, dropping dead `internal` keys. True if anything changed. */
    private fun prune(node: Any?): Boolean {
        var changed = false
        when (node) {
            is MutableMap<*, *> -> {
                val blob = node["internal"]
                if (blob is String && !inflates(blob)) {
                    node.remove("internal")
                    changed = true
                }
                node.values.forEach { if (prune(it)) changed = true }
            }
            is MutableList<*> -> node.forEach { if (prune(it)) changed = true }
        }
        return changed
    }

    /** Whether the blob still decodes and gunzips — the only thing Bukkit needs of it. */
    private fun inflates(blob: String): Boolean = runCatching {
        // MIME decoder: tolerates the whitespace a folded YAML scalar leaves behind.
        val bytes = Base64.getMimeDecoder().decode(blob)
        GZIPInputStream(bytes.inputStream()).use { it.readBytes() }
        true
    }.getOrDefault(false)
}
