package net.artisanmc.plugin.tree

import net.artisanmc.plugin.model.DocumentKinds

/**
 * [FlattenOriginals] over a tree as the editor and the database carry it: text files by path,
 * and binary files by path to whatever describes them (a hash and a size, a Version's row). A
 * Version or a draft made before its folder held the module's whole tree (ADR
 * `editable-module-tree`) is turned into today's layout before it is restored or published;
 * otherwise restoring it would delete every file the migration wrote.
 */
object FlattenSnapshot {
    private const val MARK = "\u0000artisan-binary:"

    fun <B> of(
        texts: Map<String, String>,
        binaries: Map<String, B>,
        kindDirs: Set<String> = DocumentKinds.all().map { it.dir }.toSet(),
    ): Pair<Map<String, String>, Map<String, B>> {
        if (!FlattenOriginals.needed(texts.keys + binaries.keys)) return texts to binaries
        val files = LinkedHashMap<String, ByteArray>()
        texts.forEach { (p, t) -> files[p] = t.toByteArray(Charsets.UTF_8) }
        binaries.keys.forEach { p -> files[p] = (MARK + p).toByteArray(Charsets.UTF_8) }
        val flat = FlattenOriginals.flatten(files, kindDirs)
        val outTexts = LinkedHashMap<String, String>()
        val outBinaries = LinkedHashMap<String, B>()
        for ((path, bytes) in flat) {
            val text = bytes.toString(Charsets.UTF_8)
            if (text.startsWith(MARK)) {
                val from = text.removePrefix(MARK)
                binaries[from]?.let { outBinaries[path] = it }
            } else {
                outTexts[path] = text
            }
        }
        return outTexts to outBinaries
    }

    /**
     * A `project_draft_publish` message whose draft was made before the migration: its
     * snapshot's `baseline`/`tree` and `binaryBaseline`/`binaryTree` flattened, each pair alike,
     * so that what the owner changed is still what changes (a file created over an original is a
     * change of the copied file; "back to the original" writes the original). The message as is
     * otherwise.
     */
    fun draftMessage(message: com.fasterxml.jackson.databind.JsonNode): com.fasterxml.jackson.databind.JsonNode {
        val snapshot = message.path("draft").path("snapshot") as? com.fasterxml.jackson.databind.node.ObjectNode ?: return message
        val names = listOf("baseline", "tree", "binaryBaseline", "binaryTree").flatMap { snapshot.path(it).fieldNames().asSequence().toList() }
        if (!needed(names)) return message
        val copy = message.deepCopy<com.fasterxml.jackson.databind.JsonNode>()
        val snap = copy.path("draft").path("snapshot") as com.fasterxml.jackson.databind.node.ObjectNode
        val mapper = com.fasterxml.jackson.databind.ObjectMapper()
        fun texts(name: String) = snap.path(name).fields().asSequence().associate { it.key to it.value.asText() }
        fun bins(name: String) = snap.path(name).fields().asSequence().associate { it.key to it.value }
        for ((textName, binName) in listOf("baseline" to "binaryBaseline", "tree" to "binaryTree")) {
            val (t, b) = of(texts(textName), bins(binName))
            snap.set<com.fasterxml.jackson.databind.JsonNode>(textName, mapper.valueToTree(t))
            if (snap.has(binName) || b.isNotEmpty()) snap.set<com.fasterxml.jackson.databind.JsonNode>(binName, mapper.createObjectNode().also { o -> b.forEach { (k, v) -> o.set<com.fasterxml.jackson.databind.JsonNode>(k, v) } })
        }
        return copy
    }

    /** Whether a tree of these paths is in the former layout. */
    fun needed(paths: Collection<String>): Boolean = FlattenOriginals.needed(paths)
}
