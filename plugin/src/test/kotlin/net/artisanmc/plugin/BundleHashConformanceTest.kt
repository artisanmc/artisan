package net.artisanmc.plugin

import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.LocalPushSender
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Files
import java.nio.file.Path

/**
 * Cross-language conformance: the plugin's canonical project hash MUST equal the
 * vector in `testdata/project-hash-conformance.json`, which the backend asserts too
 * (`hashUtils.test.ts`). This is the single source of truth for the byte-order /
 * keying invariant — see CLAUDE.md § Invariants critiques. If this fails, the
 * plugin and backend hashes have drifted and projects will resync in a loop.
 */
class BundleHashConformanceTest {

    private data class Fixture(val projectId: String, val files: Map<String, String>, val expectedHash: String)

    private fun loadFixture(): Fixture {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val f = File(dir, "testdata/project-hash-conformance.json")
            if (f.exists()) {
                val mapper = ObjectMapper().registerKotlinModule()
                    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
                return mapper.readValue(f, Fixture::class.java)
            }
            dir = dir.parentFile
        }
        error("conformance fixture not found from ${System.getProperty("user.dir")}")
    }

    private fun canonical(fx: Fixture): Map<String, String> =
        fx.files.mapKeys { (rel, _) -> "plugins/Artisan/projects/${fx.projectId}/$rel" }

    @Test
    fun `hashRelative matches the cross-language vector (relPath-keyed, artisan-meta excluded)`() {
        val fx = loadFixture()
        assertEquals(fx.expectedHash, BundleHasher.hashRelative(fx.files))
    }

    @Test
    fun `hashCanonical matches the vector after stripping the project prefix`() {
        val fx = loadFixture()
        assertEquals(fx.expectedHash, BundleHasher.hashCanonical(canonical(fx), fx.projectId))
    }

    @Test
    fun `local_push hash matches the vector (was full-path-keyed, now relPath)`(@TempDir tmp: Path) {
        val fx = loadFixture()
        val projectDir = tmp.resolve(fx.projectId)
        for ((rel, content) in fx.files) {
            val target = projectDir.resolve(rel)
            Files.createDirectories(target.parent)
            Files.writeString(target, content)
        }
        val msg = LocalPushSender.buildPushMessage(fx.projectId, projectDir.toFile())
        assertEquals(fx.expectedHash, msg["hash"] as String)
    }

    @Test
    fun `disk hash and local_push hash agree for the same files`(@TempDir tmp: Path) {
        val fx = loadFixture()
        val projectDir = tmp.resolve(fx.projectId)
        for ((rel, content) in fx.files) {
            val target = projectDir.resolve(rel)
            Files.createDirectories(target.parent)
            Files.writeString(target, content)
        }
        val diskHash = BundleHasher.hash(projectDir.toFile())
        val pushHash = LocalPushSender.buildPushMessage(fx.projectId, projectDir.toFile())["hash"] as String
        assertEquals(diskHash, pushHash)
    }
}
