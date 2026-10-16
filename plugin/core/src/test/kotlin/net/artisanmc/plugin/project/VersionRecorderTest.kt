package net.artisanmc.plugin.project

import net.artisanmc.plugin.protocol.PublicationAuthor
import net.artisanmc.plugin.project.ProjectFilesReader.BinaryInfo
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.time.Instant
import java.util.concurrent.Executor
import java.util.logging.Handler
import java.util.logging.LogRecord
import java.util.logging.Logger

class VersionRecorderTest {
    @TempDir lateinit var temp: File

    private class Recorded(val key: String, val folder: String, val files: Map<String, String>, val binaries: Set<String>, val at: Instant, val author: PublicationAuthor?)

    private class FakeStorage(
        val failing: Set<String> = emptySet(),
        val skipping: Map<String, List<String>> = emptyMap(),
        val failState: Boolean = false,
    ) : VersionStorage {
        val versions = ArrayList<Recorded>()
        val states = ArrayList<Pair<Map<String, Any?>, Instant>>()
        val read = ArrayList<ByteArray>()

        override fun recordVersion(
            projectKey: String, folder: String, files: Map<String, String>, binaries: Map<String, BinaryInfo>,
            at: Instant, author: PublicationAuthor?, readBinary: (path: String) -> ByteArray,
        ): List<String> {
            if (folder in failing) error("disk full")
            binaries.keys.forEach { read += readBinary(it) }
            versions += Recorded(projectKey, folder, files, binaries.keys, at, author)
            return skipping[folder].orEmpty()
        }

        override fun recordState(state: net.artisanmc.plugin.protocol.LoadedState, at: Instant) {
            if (failState) error("state table gone")
            states += state.toMap() to at
        }
    }

    private val warnings = ArrayList<String>()
    private val logger = Logger.getAnonymousLogger().apply {
        useParentHandlers = false
        addHandler(object : Handler() {
            override fun publish(record: LogRecord) { warnings += record.message }
            override fun flush() {}
            override fun close() {}
        })
    }
    private val now = Instant.parse("2026-01-02T03:04:05Z")
    private val direct = Executor { it.run() }

    private fun roots(vararg folders: String): ProjectRoots {
        val core = File(temp, "projects")
        folders.forEach { File(core, it).mkdirs() }
        return ProjectRoots(core)
    }

    private fun snapshot(vararg folders: String) = ProjectSnapshot(
        files = folders.associateWith { mapOf("menus/main.yaml" to "title: $it", ".artisan/editor.yaml" to "board: {}") },
        binaries = emptyMap(),
        skipped = emptyMap(),
    )

    private fun recorder(roots: ProjectRoots, storage: VersionStorage?, writer: Executor = direct) =
        VersionRecorder(roots, { storage }, writer, logger) { now }

    @Test fun `a Version leaves out the artisan metadata, which goes to the loaded state`() {
        val roots = roots("shop")
        val storage = FakeStorage()
        var done = 0

        recorder(roots, storage).record(snapshot("shop"), emptyMap()) { done++ }

        val version = storage.versions.single()
        assertEquals("shop", version.folder)
        assertEquals(roots.key("shop"), version.key)
        assertEquals(mapOf("menus/main.yaml" to "title: shop"), version.files)
        assertEquals(now, version.at)
        assertNull(version.author)
        @Suppress("UNCHECKED_CAST")
        val project = (storage.states.single().first["projects"] as Map<String, Map<String, Any?>>)["shop"]!!
        assertEquals(mapOf(".artisan/editor.yaml" to "board: {}"), project["meta"])
        assertEquals(snapshot("shop").hash("shop"), project["hash"])
        assertEquals(listOf("shop"), storage.states.single().first["project_ids"])
        assertEquals(1, done)
    }

    @Test fun `binaries are read from the Project folder, metadata binaries left out`() {
        val roots = roots("shop")
        File(roots.dirFor("shop"), "assets/logo.png").also { it.parentFile.mkdirs(); it.writeBytes(byteArrayOf(1, 2, 3)) }
        val storage = FakeStorage()
        val snapshot = ProjectSnapshot(
            files = mapOf("shop" to emptyMap()),
            binaries = mapOf("shop" to mapOf("assets/logo.png" to BinaryInfo("h", 3), ".artisan-trash/old.png" to BinaryInfo("o", 1))),
            skipped = emptyMap(),
        )

        recorder(roots, storage).record(snapshot, emptyMap()) {}

        assertEquals(setOf("assets/logo.png"), storage.versions.single().binaries)
        assertEquals(listOf(1, 2, 3), storage.read.single().map { it.toInt() })
    }

    @Test fun `a publication's author goes with its Project only`() {
        val storage = FakeStorage()
        val author = PublicationAuthor("uuid-1", "Alex", restoredFrom = "7")

        recorder(roots("a", "b"), storage).record(snapshot("a", "b"), mapOf("b" to author)) {}

        assertEquals(mapOf("a" to null, "b" to author), storage.versions.associate { it.folder to it.author })
    }

    @Test fun `one failed Version keeps the previous loaded state, the other Projects still get theirs`() {
        val storage = FakeStorage(failing = setOf("a"))
        var done = 0

        recorder(roots("a", "b"), storage).record(snapshot("a", "b"), emptyMap()) { done++ }

        assertEquals(listOf("b"), storage.versions.map { it.folder })
        assertTrue(storage.states.isEmpty())
        assertEquals(1, done)
        assertTrue(warnings.any { "Version of project a not recorded: disk full" in it })
        assertTrue(warnings.any { "1 Version(s) failed" in it })
    }

    @Test fun `binaries changed on disk since the reload are reported, the state still recorded`() {
        val storage = FakeStorage(skipping = mapOf("a" to listOf("assets/x.png")))

        recorder(roots("a"), storage).record(snapshot("a"), emptyMap()) {}

        assertTrue(warnings.any { "Project a: assets/x.png changed on disk" in it })
        assertEquals(1, storage.states.size)
    }

    @Test fun `a loaded state that fails to record still completes`() {
        var done = 0

        recorder(roots("a"), FakeStorage(failState = true)).record(snapshot("a"), emptyMap()) { done++ }

        assertEquals(1, done)
        assertTrue(warnings.any { "Loaded state not recorded: state table gone" in it })
    }

    @Test fun `without storage nothing is recorded and done still runs`() {
        var done = 0

        recorder(roots("a"), null).record(snapshot("a"), emptyMap()) { done++ }

        assertEquals(1, done)
    }

    @Test fun `the time is taken when the Snapshot is queued, the storage read when it runs`() {
        val queued = ArrayList<Runnable>()
        val storage = FakeStorage()
        var open: VersionStorage? = null
        var clock = now
        val recorder = VersionRecorder(roots("a"), { open }, { queued += it }, logger) { clock }

        recorder.record(snapshot("a"), emptyMap()) {}
        clock = now.plusSeconds(60)
        open = storage
        queued.single().run()

        assertEquals(now, storage.versions.single().at)
        assertEquals(now, storage.states.single().second)
    }
}
