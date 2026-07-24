package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.sync.ProjectWatcher
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * ADR files-first-source-of-truth #6 (P3b): debounced disk watcher per project
 * root — a hand/agent edit on disk hot-reloads locally and auto-pushes.
 * `.artisan*` metadata and self-writes (sync downloads, via the suppression
 * window) never trigger it.
 */
class ProjectWatcherTest {

    private val watchers = mutableListOf<ProjectWatcher>()

    @AfterTest
    fun teardown() {
        watchers.forEach { it.stop() }
    }

    private fun newProject(packsRoot: File, id: String): File {
        val dir = File(packsRoot, id).apply { mkdirs() }
        File(dir, "manifest.yaml").writeText("schema: manifest/v1\nproject_id: $id\n")
        File(dir, "menus").mkdirs()
        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: T\nsize: 27\nelements: []\n")
        return dir
    }

    private fun startWatcher(
        packsRoot: File,
        events: CopyOnWriteArrayList<Set<String>>,
        debounceMs: Long = 200,
    ): ProjectWatcher {
        val w = ProjectWatcher(ProjectRoots(packsRoot), debounceMs = debounceMs, logger = null) { ids ->
            events.add(ids)
        }
        w.start()
        watchers.add(w)
        // Give the watch registration a beat before mutating the tree.
        Thread.sleep(150)
        return w
    }

    private fun awaitEvent(events: List<Set<String>>, timeoutMs: Long = 5000, predicate: (Set<String>) -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (events.any(predicate)) return
            Thread.sleep(25)
        }
        fail("expected watcher event within ${timeoutMs}ms — got: $events")
    }

    private fun assertNoEvent(events: List<Set<String>>, waitMs: Long = 1200) {
        Thread.sleep(waitMs)
        assertTrue(events.isEmpty(), "expected no watcher event — got: $events")
    }

    @Test
    fun `edit inside a project fires one debounced event with the projectId`() {
        val packsRoot = Files.createTempDirectory("artisan_watch_").toFile()
        val dir = newProject(packsRoot, "p_a")
        val events = CopyOnWriteArrayList<Set<String>>()
        startWatcher(packsRoot, events)

        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: T2\nsize: 27\nelements: []\n")

        awaitEvent(events) { "p_a" in it }
    }

    @Test
    fun `a burst of writes coalesces into a single event`() {
        val packsRoot = Files.createTempDirectory("artisan_watch_").toFile()
        val dir = newProject(packsRoot, "p_burst")
        val events = CopyOnWriteArrayList<Set<String>>()
        startWatcher(packsRoot, events, debounceMs = 400)

        repeat(5) { i ->
            File(dir, "menus/m$i.yaml").writeText("schema: menu/v1\nid: m$i\ntitle: T\nsize: 27\nelements: []\n")
            Thread.sleep(30)
        }

        awaitEvent(events) { "p_burst" in it }
        Thread.sleep(600)
        assertTrue(events.size == 1, "burst must coalesce into one event — got ${events.size}: $events")
    }

    @Test
    fun `artisan metadata writes never fire`() {
        val packsRoot = Files.createTempDirectory("artisan_watch_").toFile()
        val dir = newProject(packsRoot, "p_meta")
        val events = CopyOnWriteArrayList<Set<String>>()
        startWatcher(packsRoot, events)

        File(dir, ".artisan-sync.yaml").writeText("synced_hash: x\n")
        File(dir, ".artisan").mkdirs()
        File(dir, ".artisan/editor.yaml").writeText("schema: editor-state/v1\n")

        assertNoEvent(events)
    }

    @Test
    fun `suppression window swallows self-writes (bundle download)`() {
        val packsRoot = Files.createTempDirectory("artisan_watch_").toFile()
        val dir = newProject(packsRoot, "p_sup")
        val events = CopyOnWriteArrayList<Set<String>>()
        val w = startWatcher(packsRoot, events)

        w.beginSuppress("p_sup")
        File(dir, "menus/m.yaml").writeText("schema: menu/v1\nid: m\ntitle: FROM_SYNC\nsize: 27\nelements: []\n")
        Thread.sleep(200)
        w.endSuppress("p_sup", graceMs = 1000)

        assertNoEvent(events, waitMs = 1500)
    }

    @Test
    fun `files in a newly created subdirectory are watched (recursive)`() {
        val packsRoot = Files.createTempDirectory("artisan_watch_").toFile()
        val dir = newProject(packsRoot, "p_rec")
        val events = CopyOnWriteArrayList<Set<String>>()
        startWatcher(packsRoot, events)

        File(dir, "data").mkdirs()
        Thread.sleep(300) // let the watcher register the new dir
        File(dir, "data/src.yaml").writeText("schema: data/v1\nid: src\nshape: config\nfields: []\nvalue: {}\n")

        awaitEvent(events) { "p_rec" in it }
    }

    @Test
    fun `a brand-new project directory at the root is picked up`() {
        val packsRoot = Files.createTempDirectory("artisan_watch_").toFile()
        val events = CopyOnWriteArrayList<Set<String>>()
        startWatcher(packsRoot, events)

        newProject(packsRoot, "p_new")

        awaitEvent(events) { "p_new" in it }
    }
}
