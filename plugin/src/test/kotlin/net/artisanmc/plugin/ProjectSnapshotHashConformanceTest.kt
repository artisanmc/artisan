package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.sync.BundleHasher
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

class ProjectSnapshotHashConformanceTest {
    @Test
    fun `hosted and server snapshot fingerprints use the same portable vectors`() {
        val vectors = ObjectMapper().readTree(File("../testdata/project-snapshot-hash-conformance.json"))
        for (case in vectors["cases"]) {
            fun entries(key: String) = case[key].fields().asSequence().associate { it.key to it.value.asText() }
            assertEquals(case["hash"].asText(), BundleHasher.snapshotHash(entries("files"), entries("binaries"), entries("failed")), case["name"].asText())
        }
    }
}
