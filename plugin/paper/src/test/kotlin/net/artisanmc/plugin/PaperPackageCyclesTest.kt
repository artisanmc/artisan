package net.artisanmc.plugin

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Paper's packages form a DAG, like the core's ([PackageCyclesTest] there). Paper reuses some core
 * package names (`engine`, `render`, `provider`…), so an edge counts only when the referenced
 * name is declared in paper's own sources. The composition root (`net.artisanmc.plugin`, the
 * plugin class) is the one exception: it wires every package and hands itself to `ArtisanCommand`.
 */
class PaperPackageCyclesTest {
    private val root = listOf("src/main/kotlin/net/artisanmc/plugin", "paper/src/main/kotlin/net/artisanmc/plugin")
        .map(::File).firstOrNull { it.isDirectory } ?: File("src/main/kotlin/net/artisanmc/plugin")
    private val packageLine = Regex("""^package (\S+)""", RegexOption.MULTILINE)
    private val declaration = Regex(
        """^(?:@\S+\s+)*(?:(?:public|internal|private|data|sealed|abstract|open|enum|inline|value|fun)\s+)*""" +
            """(?:class|object|interface|typealias|fun|val)\s+(?:<[^>]*>\s*)?(?:[A-Za-z_]+\.)?([A-Za-z_]\w*)""",
        RegexOption.MULTILINE,
    )
    private val qualified = Regex("""(net\.artisanmc\.plugin(?:\.[a-z]+)*)\.([A-Za-z_]\w*)""")
    private val wildcard = Regex("""^import (net\.artisanmc\.plugin(?:\.[a-z]+)*)\.\*$""", RegexOption.MULTILINE)

    private fun top(pkg: String) = pkg.removePrefix("net.artisanmc.plugin").trimStart('.').substringBefore('.')

    @Test
    fun `no two paper packages import each other`() {
        assertTrue(root.isDirectory, "run from the paper module: ${root.absolutePath}")
        val files = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.map { it.readText() }.toList()
        val declared = files.flatMap { text ->
            val pkg = packageLine.find(text)!!.groupValues[1]
            declaration.findAll(text).map { pkg to it.groupValues[1] }.toList()
        }.toSet()
        val edges = mutableMapOf<String, MutableSet<String>>()
        for (text in files) {
            val pkg = packageLine.find(text)!!.groupValues[1]
            val code = text.lineSequence()
                .filterNot { it.trimStart().let { l -> l.startsWith("*") || l.startsWith("/*") || l.startsWith("//") } }
                .joinToString("\n")
            val targets = qualified.findAll(code).map { it.groupValues[1] to it.groupValues[2] }.filter { it in declared }.map { it.first } +
                wildcard.findAll(text).map { it.groupValues[1] }.filter { w -> declared.any { (p, n) -> p == w && Regex("""\b$n\b""").containsMatchIn(code) } }
            targets.map(::top).filter { it != top(pkg) }.forEach { edges.getOrPut(top(pkg)) { mutableSetOf() } += it }
        }
        assertTrue(edges.isNotEmpty(), "no import read under ${root.absolutePath}")
        val cycles = edges.flatMap { (a, targets) -> targets.filter { b -> a < b && a in edges[b].orEmpty() }.map { b -> "$a <-> $b" } }
            .filterNot { it.startsWith(" <-> ") || it.endsWith(" <-> ") }
        assertEquals(emptyList(), cycles.sorted())
    }
}
