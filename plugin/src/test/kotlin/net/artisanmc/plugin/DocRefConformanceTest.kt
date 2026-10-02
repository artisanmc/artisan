package net.artisanmc.plugin

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.engine.DocumentTable
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * `testdata/doc-ref-conformance.json` fixe la résolution d'une référence de
 * Document sur un serveur à plusieurs projects. L'éditeur (`docRef.test.ts`) lit
 * le même vecteur : le lien que la planche dessine est celui que le jeu suit.
 */
class DocRefConformanceTest {
    private data class Doc(val project: String, val id: String)

    private fun vector(): JsonNode {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/doc-ref-conformance.json")
            if (f.exists()) return ObjectMapper().readTree(f)
            dir = dir.parentFile
        }
        error("testdata/doc-ref-conformance.json not found")
    }

    @Test
    fun `plugin resolution matches the shared vector`() {
        val v = vector()
        val docs = v["documents"].map { Doc(it["project"].asText(), it["id"].asText()) }
        val table = DocumentTable(docs.map { it.project to it }) { it.id }
        for (c in v["cases"]) {
            val from = c["from"].takeUnless { it.isNull }?.asText()
            val got = when (val r = table.resolve(c["ref"].asText(), from)) {
                is DocumentTable.Found -> "${r.value.project}:${r.value.id}"
                is DocumentTable.Ambiguous -> "ambiguous"
                DocumentTable.Missing -> "missing"
            }
            assertEquals(c["expect"].asText(), got, "ref=${c["ref"]} from=$from")
        }
    }
}
