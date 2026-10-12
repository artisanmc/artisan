package net.artisanmc.plugin.yaml

/**
 * Project lang files are authored as YAML trees (`menus:` → `<menu_id>:` → …)
 * but the runtime addresses translations by dotted key. This is the reader half
 * of the codec; the editor owns the writer (`editor/src/lib/langTree.ts`) and
 * the shared vector `testdata/lang-tree-conformance.json` locks the two
 * together.
 *
 * Tolerant by design (ADR files-first-source-of-truth): a file may be fully
 * nested, still flat, or any mix — a dotted key sitting inside a branch just
 * extends the path. Non-string scalars coerce (a `1.21` value is a translation,
 * not a float), `null` is the "" sentinel, lists are skipped.
 */
object LangFlattener {

    fun flatten(tree: Any?): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        walk(tree, "", out)
        return out
    }

    private fun walk(node: Any?, path: String, out: MutableMap<String, String>) {
        when (node) {
            is List<*> -> return
            null -> if (path.isNotEmpty()) out[path] = ""
            is Map<*, *> -> for ((seg, child) in node) {
                walk(child, if (path.isEmpty()) seg.toString() else "$path.$seg", out)
            }
            else -> if (path.isNotEmpty()) out[path] = node.toString()
        }
    }
}
