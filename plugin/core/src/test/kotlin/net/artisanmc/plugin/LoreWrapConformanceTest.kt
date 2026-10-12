package net.artisanmc.plugin

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.render.LoreWrap
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.TestFactory
import java.io.File

/** Plugin half of `testdata/lore-wrap-conformance.json` — the editor asserts the same vector. */
class LoreWrapConformanceTest {

    private fun vector(): JsonNode {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/lore-wrap-conformance.json")
            if (f.exists()) return ObjectMapper().readTree(f)
            dir = dir.parentFile
        }
        error("testdata/lore-wrap-conformance.json not found")
    }

    @TestFactory
    fun cases(): List<DynamicTest> = vector()["cases"].map { c ->
        DynamicTest.dynamicTest(c["name"].asText()) {
            assertEquals(
                c["expected"].map { it.asText() },
                LoreWrap.wrap(c["line"].asText(), c["width"].asInt()),
            )
        }
    }
}
