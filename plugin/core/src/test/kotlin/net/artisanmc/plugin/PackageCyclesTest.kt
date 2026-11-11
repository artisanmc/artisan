package net.artisanmc.plugin

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The core's packages form a DAG: a package that imports another is never imported back, so
 * each can be read (and moved) from the bottom up. A cycle is broken by moving the shared type
 * to the lower package. KDoc links are not dependencies and are ignored.
 */
class PackageCyclesTest {
    /** The core's sources, from the module directory (Gradle's default) or from `plugin/`. */
    private val root = listOf("src/main/kotlin/net/artisanmc/plugin", "core/src/main/kotlin/net/artisanmc/plugin")
        .map(::File).firstOrNull { it.isDirectory } ?: File("src/main/kotlin/net/artisanmc/plugin")
    private val reference = Regex("""net\.artisanmc\.plugin\.([a-z]+)\.[A-Za-z]""")

    private fun packageOf(text: String) =
        Regex("""^package net\.artisanmc\.plugin\.?([a-z]*)""", RegexOption.MULTILINE).find(text)?.groupValues?.get(1).orEmpty()

    @Test
    fun `no two core packages import each other`() {
        assertTrue(root.isDirectory, "run from the core module: ${root.absolutePath}")
        val edges = mutableMapOf<String, MutableSet<String>>()
        root.walkTopDown().filter { it.isFile && it.extension == "kt" }.forEach { file ->
            val text = file.readText()
            val from = packageOf(text)
            text.lineSequence()
                .filterNot { it.trimStart().let { l -> l.startsWith("*") || l.startsWith("/*") || l.startsWith("//") } }
                .flatMap { line -> reference.findAll(line.substringBefore("//")).map { it.groupValues[1] } }
                .filter { it != from }
                .forEach { edges.getOrPut(from) { mutableSetOf() } += it }
        }
        assertTrue("engine" in edges, "no import read under ${root.absolutePath}")
        val cycles = edges.flatMap { (a, targets) -> targets.filter { b -> a < b && a in edges[b].orEmpty() }.map { b -> "$a <-> $b" } }
        assertEquals(emptyList(), cycles.sorted())
    }
}
