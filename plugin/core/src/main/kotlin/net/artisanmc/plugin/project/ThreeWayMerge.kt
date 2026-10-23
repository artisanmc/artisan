package net.artisanmc.plugin.project

/**
 * The three-way merge of a system file (design `commandes-unifiees` §5): [base] the version the
 * owner's file was copied from, [ours] the owner's file, [theirs] the version the module ships
 * now, each as YAML reads it (maps, lists, scalars). What only one side changed is taken from
 * it; what both changed alike is kept once.
 *
 * - Maps merge key by key, in the owner's order, a key only the module added after the one it
 *   follows in the module's version.
 * - A list of maps that all carry a scalar `id` (else `name`), unique in each version, merges
 *   item by item, matched by it: a menu's layers and elements, a command's sub-commands and
 *   arguments. An item the module added goes after the one it follows in the module's list.
 * - Any other list (a title's segments, a list of actions) is one value.
 *
 * A value both sides changed differently is a conflict: the owner's stays, and its path
 * (`subcommands.sell.permission`) is reported.
 */
object ThreeWayMerge {
    data class Result(val value: Any?, val conflicts: List<String>)

    /** A key or an item one version does not hold. */
    private object Missing

    fun merge(base: Any?, ours: Any?, theirs: Any?): Result {
        val conflicts = mutableListOf<String>()
        val value = merge(base, ours, theirs, "", conflicts)
        return Result(value.takeUnless { it === Missing }, conflicts)
    }

    private fun merge(base: Any?, ours: Any?, theirs: Any?, path: String, conflicts: MutableList<String>): Any? {
        if (ours == theirs) return ours
        if (ours == base) return theirs
        if (theirs == base) return ours
        if (base is Map<*, *> && ours is Map<*, *> && theirs is Map<*, *>) return mergeMaps(base, ours, theirs, path, conflicts)
        if (base is List<*> && ours is List<*> && theirs is List<*>) {
            identity(base, ours, theirs)?.let { return mergeLists(it, base, ours, theirs, path, conflicts) }
        }
        conflicts += path.ifEmpty { "." }
        return ours
    }

    private fun mergeMaps(base: Map<*, *>, ours: Map<*, *>, theirs: Map<*, *>, path: String, conflicts: MutableList<String>): Map<Any?, Any?> {
        val keys = ordered(ours.keys.toList(), theirs.keys.toList())
        val out = linkedMapOf<Any?, Any?>()
        for (key in keys) {
            val merged = merge(base.getOrMissing(key), ours.getOrMissing(key), theirs.getOrMissing(key), join(path, key), conflicts)
            if (merged !== Missing) out[key] = merged
        }
        return out
    }

    private fun mergeLists(key: String, base: List<*>, ours: List<*>, theirs: List<*>, path: String, conflicts: MutableList<String>): List<Any?> {
        fun index(list: List<*>) = list.associateBy { (it as Map<*, *>)[key] }
        val b = index(base)
        val o = index(ours)
        val t = index(theirs)
        val ids = ordered(ours.map { (it as Map<*, *>)[key] }, theirs.map { (it as Map<*, *>)[key] })
        return ids.mapNotNull { id ->
            val merged = merge(b.getOrMissing(id), o.getOrMissing(id), t.getOrMissing(id), join(path, id), conflicts)
            merged.takeUnless { it === Missing }
        }
    }

    /** The key a list's items are matched by, or null when it is one value. */
    private fun identity(vararg lists: List<*>): String? = listOf("id", "name").firstOrNull { key ->
        lists.all { list ->
            val ids = list.map { item -> ((item as? Map<*, *>)?.get(key))?.takeIf { it is String || it is Number } ?: return@firstOrNull false }
            ids.toSet().size == ids.size
        } && lists.any { it.isNotEmpty() }
    }

    /** [ours] in its order, each element only [theirs] holds after the one it follows there. */
    private fun ordered(ours: List<Any?>, theirs: List<Any?>): List<Any?> {
        val out = ours.toMutableList()
        theirs.forEachIndexed { i, item ->
            if (item in out) return@forEachIndexed
            val after = theirs.subList(0, i).lastOrNull { it in out }
            out.add(if (after == null) 0 else out.indexOf(after) + 1, item)
        }
        return out
    }

    private fun Map<*, *>.getOrMissing(key: Any?): Any? = if (containsKey(key)) get(key) else Missing

    private fun join(path: String, key: Any?) = if (path.isEmpty()) "$key" else "$path.$key"
}
