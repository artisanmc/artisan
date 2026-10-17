package net.artisanmc.plugin

import net.artisanmc.modules.api.editor.EditorBundleDeclaration
import net.artisanmc.modules.api.editor.EditorBundleRegistry
import net.artisanmc.plugin.scheduling.Scheduler
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

/**
 * Development: a module's editor view read from a file on this server's disk instead of its
 * jar (`dev.editor-bundles` in environment.yml, `<module id>: <path to ui.js>`). The file is
 * re-read when it changes and announced again, so a `vite build --watch` next to the server and
 * a reload of the editor show the new view without a restart.
 *
 * Only a module that registered a bundle is overridden: the file takes its SDK version. A file
 * missing or invalid falls back to the jar's bundle, with one warning per state of the file.
 * The path lives in environment.yml, which the editor never writes: no editor user can make
 * the server serve one of its files.
 */
internal class LocalEditorBundles(
    private val registry: EditorBundleRegistry,
    private val logger: Logger,
    private val root: File = File("."),
) {
    @Volatile private var paths: Map<String, File> = emptyMap()
    private val loaded = ConcurrentHashMap<String, Loaded>()
    @Volatile private var watching = false

    /** What a file held when last read: its stamp, and the bundle it made (null: invalid). */
    private class Loaded(val stamp: String, val bundle: EditorBundleDeclaration?)

    fun configure(entries: Map<String, String>) {
        paths = entries.mapValues { (_, path) -> File(path).let { if (it.isAbsolute) it else File(root, path) } }
        loaded.keys.retainAll(paths.keys)
        for ((module, file) in paths) logger.info("[Artisan] dev: editor view of '$module' read from ${file.path}")
    }

    /** The bundle served for [moduleId]: its local file when one is set and valid, else the jar's. */
    fun find(moduleId: String): EditorBundleDeclaration? {
        val registered = registry.find(moduleId) ?: return null
        val file = paths[moduleId] ?: return registered
        return read(moduleId, file, registered.sdk) ?: registered
    }

    /** The `editor_bundle` announced for [moduleId], with `local: true` when its local file is served. */
    fun wire(moduleId: String): Map<String, Any?>? {
        val bundle = find(moduleId) ?: return null
        val local = paths.containsKey(moduleId) && bundle !== registry.find(moduleId)
        return if (local) bundle.toWire() + ("local" to true) else bundle.toWire()
    }

    /** Re-reads the files that changed; true when one of them did. */
    fun refresh(): Boolean = paths.keys.fold(false) { changed, module ->
        val before = loaded[module]?.stamp
        find(module)
        changed || loaded[module]?.stamp != before
    }

    /** Checks the files every second, off the game threads; [onChange] after a change. */
    fun watch(scheduler: Scheduler, onChange: () -> Unit) {
        if (paths.isEmpty() || watching) return
        watching = true
        fun tick() {
            if (!watching) return
            runCatching { if (refresh()) onChange() }
                .onFailure { logger.warning("[Artisan] dev: editor view check failed: ${it.message}") }
            scheduler.asyncLater(20) { tick() }
        }
        scheduler.asyncLater(20) { tick() }
    }

    fun stop() {
        watching = false
    }

    private fun read(moduleId: String, file: File, sdk: String): EditorBundleDeclaration? {
        val stamp = if (file.isFile) "${file.lastModified()}:${file.length()}" else "missing"
        loaded[moduleId]?.takeIf { it.stamp == stamp }?.let { return it.bundle }
        val bundle = if (stamp == "missing") {
            logger.warning("[Artisan] dev: ${file.path} not found, the editor view of '$moduleId' comes from its jar")
            null
        } else {
            runCatching { EditorBundleDeclaration(file.readBytes(), sdk) }
                .onFailure { logger.warning("[Artisan] dev: ${file.path} refused (${it.message}), the editor view of '$moduleId' comes from its jar") }
                .getOrNull()
        }
        loaded[moduleId] = Loaded(stamp, bundle)
        return bundle
    }
}
