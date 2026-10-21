package net.artisanmc.plugin

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.model.DocumentLayout
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/** Plugin half of `testdata/document-layout-conformance.json` — the editor asserts the same vector. */
class DocumentLayoutConformanceTest {

    private fun vector(): JsonNode {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/document-layout-conformance.json")
            if (f.exists()) return ObjectMapper().readTree(f)
            dir = dir.parentFile
        }
        error("testdata/document-layout-conformance.json not found")
    }

    @TestFactory
    fun cases(): List<DynamicTest> = vector()["cases"].map { c ->
        DynamicTest.dynamicTest(c["name"].asText()) {
            val result = DocumentLayout.classify(
                c["paths"].map { it.asText() },
                c["kindDirs"].map { it.asText() }.toSet(),
            )
            assertEquals(
                c["documents"].map { DocumentLayout.Entry(it["path"].asText(), it["dir"].asText(), it["id"].asText(), it["folder"].asText()) },
                result.documents,
            )
            assertEquals(
                c["errors"].map { DocumentLayout.Error(it["path"].asText(), it["reason"].asText()) },
                result.errors,
            )
        }
    }
}
