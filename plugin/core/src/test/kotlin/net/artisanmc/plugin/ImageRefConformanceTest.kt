package net.artisanmc.plugin

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.render.ImageRefs
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * `testdata/image-ref-conformance.json` pins which image a name in a module's file is. Both pack
 * builders read the same file: the game looks up the id the pack was written with.
 */
class ImageRefConformanceTest {
    private fun vector(): JsonNode {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/image-ref-conformance.json")
            if (f.exists()) return ObjectMapper().readTree(f)
            dir = dir.parentFile
        }
        error("testdata/image-ref-conformance.json not found")
    }

    @Test
    fun `the game reaches the id the pack was written with`() {
        val v = vector()
        val ids = HashSet<String>()
        for (module in v["modules"]) module["fonts"].mapTo(ids) { it.asText() }
        for ((_, images) in v["ids"].properties()) images.properties().mapTo(ids) { it.value.asText() }
        v["also"].mapTo(ids) { it.asText() }
        for (c in v["cases"]) {
            val from = c["from"].takeUnless { it.isNull }?.asText().orEmpty()
            assertEquals(c["expect"].asText(), ImageRefs.resolve(ids::contains, from, c["ref"].asText()), "ref=${c["ref"]} from=$from")
        }
    }
}
