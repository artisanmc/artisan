package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.sync.SyncScanner
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Poll-first disk sync (spec `2026-07-30-poll-first-disk-sync-design`).
 *
 * Every test drives ticks by hand — the scheduler interval is set past the test
 * lifetime — so nothing here depends on inotify delivery, wall-clock sleeps or
 * the host filesystem. These tests behave identically on Linux, Windows and
 * Docker bind mounts, which is the whole point of the mechanism.
 */
class SyncScannerTest {

    private val scanners = mutableListOf<SyncScanner>()
    private var mtimeCounter = 0L

    @AfterTest
    fun teardown() = scanners.forEach { it.stop() }

    private fun newProject(packsRoot: File, id: String): File {
        val dir = File(packsRoot, id).apply { mkdirs() }
        write(File(dir, "manifest.yaml"), "schema: manifest/v1\nproject_id: $id\n")
        File(dir, "menus").mkdirs()
        write(File(dir, "menus/m.yaml"), "schema: menu/v1\nid: m\ntitle: T\nsize: 27\nelements: []\n")
        return dir
    }

    /** Write + stamp a distinct mtime, so a same-size edit is still visible to `stat`. */
    private fun write(file: File, text: String) {
        file.parentFile?.mkdirs()
        file.writeText(text)
        file.setLastModified(1_700_000_000_000L + (mtimeCounter++ * 2_000L))
    }

    private fun scanner(
        packsRoot: File,
        events: CopyOnWriteArrayList<Set<String>>,
        quiescentTicks: Int = 2,
        deepTickEvery: Int = 100,
    ): SyncScanner = SyncScanner(
        ProjectRoots(packsRoot),
        intervalMs = 3_600_000,
        quiescentTicks = quiescentTicks,
        deepTickEvery = deepTickEvery,
        logger = null,
    ) { events.add(it) }.also {
        it.start()
        scanners.add(it)
    }

    private fun SyncScanner.tick(n: Int = 1) = repeat(n) { scanNow() }

    @Test
    fun `boot state is not an edit — no dispatch while the tree is untouched`() {
        val packsRoot = Files.createTempDirectory("artisan_scan_").toFile()
        newProject(packsRoot, "p_boot")
        val events = CopyOnWriteArrayList<Set<String>>()
        val s = scanner(packsRoot, events)

        s.tick(5)

        assertEquals(emptyList(), events)
    }

    @Test
    fun `an edit dispatches once, after quiescence`() {
        val packsRoot = Files.createTempDirectory("artisan_scan_").toFile()
        val dir = newProject(packsRoot, "p_edit")
        val events = CopyOnWriteArrayList<Set<String>>()
        val s = scanner(packsRoot, events)

        write(File(dir, "menus/m.yaml"), "schema: menu/v1\nid: m\ntitle: T2\nsize: 27\nelements: []\n")

        s.tick()
        assertEquals(emptyList(), events, "first sighting must wait for quiescence")
        s.tick()
        assertEquals(listOf(setOf("p_edit")), events)

        // Stable tree afterwards ⇒ never dispatched again.
        s.tick(5)
        assertEquals(1, events.size, "a settled tree must not re-dispatch — got $events")
    }

    @Test
    fun `a tree still being written is not dispatched until it settles`() {
        val packsRoot = Files.createTempDirectory("artisan_scan_").toFile()
        val dir = newProject(packsRoot, "p_upload")
        val events = CopyOnWriteArrayList<Set<String>>()
        val s = scanner(packsRoot, events)

        // Simulates an FTP upload landing across ticks — never quiescent.
        repeat(4) { i ->
            write(File(dir, "menus/m$i.yaml"), "schema: menu/v1\nid: m$i\ntitle: T\nsize: 27\nelements: []\n")
            s.tick()
        }
        assertEquals(emptyList(), events, "a half-written tree must never be pushed")

        // Upload finished — one dispatch covering the whole burst.
        s.tick(2)
        assertEquals(listOf(setOf("p_upload")), events)
    }

    @Test
    fun `artisan metadata writes are invisible`() {
        val packsRoot = Files.createTempDirectory("artisan_scan_").toFile()
        val dir = newProject(packsRoot, "p_meta")
        val events = CopyOnWriteArrayList<Set<String>>()
        val s = scanner(packsRoot, events)

        write(File(dir, ".artisan-sync.yaml"), "synced_hash: x\n")
        write(File(dir, ".artisan/editor.yaml"), "schema: editor-state/v1\n")

        s.tick(5)
        assertEquals(emptyList(), events)
    }

    @Test
    fun `a same-size same-mtime edit is caught by the deep tick`() {
        val packsRoot = Files.createTempDirectory("artisan_scan_").toFile()
        val dir = newProject(packsRoot, "p_coarse")
        val events = CopyOnWriteArrayList<Set<String>>()
        val s = scanner(packsRoot, events, deepTickEvery = 3)

        // A filesystem with coarse mtime granularity: the edit is invisible to `stat`.
        val menu = File(dir, "menus/m.yaml")
        val mtime = menu.lastModified()
        menu.writeText("schema: menu/v1\nid: m\ntitle: X\nsize: 27\nelements: []\n")
        menu.setLastModified(mtime)
        assertEquals(
            s.statSignature(dir), s.statSignature(dir),
            "sanity: signature must be stable for an unchanged tree",
        )

        s.tick(2)
        assertEquals(emptyList(), events, "stat alone cannot see this edit")
        s.tick() // third tick = deep
        assertEquals(listOf(setOf("p_coarse")), events)
    }

    @Test
    fun `files in a newly created subdirectory are seen`() {
        val packsRoot = Files.createTempDirectory("artisan_scan_").toFile()
        val dir = newProject(packsRoot, "p_rec")
        val events = CopyOnWriteArrayList<Set<String>>()
        val s = scanner(packsRoot, events)

        write(File(dir, "data/src.yaml"), "schema: data/v1\nid: src\nshape: config\nfields: []\nvalue: {}\n")

        s.tick(2)
        assertTrue("p_rec" in events.flatten())
    }

    @Test
    fun `a brand-new project directory at the root is picked up`() {
        val packsRoot = Files.createTempDirectory("artisan_scan_").toFile()
        val events = CopyOnWriteArrayList<Set<String>>()
        val s = scanner(packsRoot, events)

        newProject(packsRoot, "p_new")

        s.tick(2)
        assertTrue("p_new" in events.flatten())
    }

    @Test
    fun `a self-write recorded as synced never dispatches twice`() {
        // The anti-loop guarantee that used to require the suppression window:
        // once dispatched at signature S, the project stays quiet until the tree
        // actually changes again — whatever the timing of the write.
        val packsRoot = Files.createTempDirectory("artisan_scan_").toFile()
        val dir = newProject(packsRoot, "p_echo")
        val events = CopyOnWriteArrayList<Set<String>>()
        val s = scanner(packsRoot, events, deepTickEvery = 2)

        write(File(dir, "menus/m.yaml"), "schema: menu/v1\nid: m\ntitle: FROM_SYNC\nsize: 27\nelements: []\n")
        s.tick(2)
        assertEquals(1, events.size)

        s.tick(10)
        assertEquals(1, events.size, "no echo dispatch — got $events")
    }
}
