package net.artisanmc.plugin.engine

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class DocumentTableTest {
    private data class Doc(val project: String, val id: String)

    private fun table(vararg docs: Doc) =
        DocumentTable(docs.map { it.project to it }) { it.id }

    @Test
    fun `a bare id resolves in the referencing project first`() {
        val t = table(Doc("core", "main"), Doc("shop", "main"))
        assertEquals(Doc("core", "main"), t.resolve("main", "core").value)
        assertEquals(Doc("shop", "main"), t.resolve("main", "shop").value)
    }

    @Test
    fun `a bare id absent from the project resolves on the server when unique`() {
        val t = table(Doc("core", "accueil"), Doc("shop", "catalogue"))
        val r = t.resolve("catalogue", "core")
        assertIs<DocumentTable.Found<Doc>>(r)
        assertEquals(Doc("shop", "catalogue"), r.value)
    }

    @Test
    fun `a bare id defined by two other projects is ambiguous and keeps the legacy winner`() {
        val t = table(Doc("a", "dup"), Doc("b", "dup"))
        val r = t.resolve("dup", "core")
        assertIs<DocumentTable.Ambiguous<Doc>>(r)
        // Before namespaces the table kept the LAST loaded entry: never change which menu opens.
        assertEquals(Doc("b", "dup"), r.value)
        assertEquals(listOf("a", "b"), r.projects)
    }

    @Test
    fun `without a referencing project, a bare id resolves on the server`() {
        val t = table(Doc("core", "main"), Doc("shop", "other"))
        assertEquals(Doc("core", "main"), t.resolve("main", null).value)
        assertIs<DocumentTable.Ambiguous<Doc>>(table(Doc("a", "x"), Doc("b", "x")).resolve("x", null))
    }

    @Test
    fun `a qualified ref resolves in its project only`() {
        val t = table(Doc("core", "main"), Doc("shop", "main"))
        assertEquals(Doc("shop", "main"), t.resolve("shop:main", "core").value)
    }

    @Test
    fun `a qualified ref to an unknown project or document is missing`() {
        val t = table(Doc("shop", "main"))
        assertIs<DocumentTable.Missing>(t.resolve("nope:main", null))
        assertIs<DocumentTable.Missing>(t.resolve("shop:absent", null))
        assertNull(t.resolve("absent", "shop").value)
    }

    @Test
    fun `a malformed ref is read whole, as the editor does`() {
        val t = table(Doc("core", ":odd"), Doc("core", "odd:"))
        assertEquals(Doc("core", ":odd"), t.resolve(":odd", null).value)
        assertEquals(Doc("core", "odd:"), t.resolve("odd:", null).value)
    }

    @Test
    fun `lists every bare id once`() {
        assertEquals(setOf("main", "x"), table(Doc("a", "main"), Doc("b", "main"), Doc("b", "x")).ids)
    }
}
