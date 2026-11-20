package net.artisanmc.plugin.importing

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.importing.ImportRegistry
import net.artisanmc.modules.api.importing.ImportReport
import net.artisanmc.modules.api.importing.ImportRequest
import net.artisanmc.modules.api.importing.ImporterDeclaration
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** One run as logged in `artisan_import_runs`. */
data class ImportRun(
    val batch: String,
    val source: String,
    val module: String,
    /** `plan`, `apply` or `rollback`. */
    val action: String,
    /** True when the run wrote something. */
    val applied: Boolean,
    val actor: String,
    val at: Long,
    /** For a rollback, the batch it undid. */
    val target: String?,
    val reportJson: String,
)

/** Where runs are kept; `ImportRunRows` in the database, a list in tests. */
interface ImportRunLog {
    fun record(run: ImportRun)
    /** The applied import [batch], or null. */
    fun findApplied(batch: String): ImportRun?
    fun recent(limit: Int): List<ImportRun>
}

/** Why a run did not start; each is a lang key `import.refused.<code>`. */
sealed class Refusal(val code: String, val args: Map<String, String> = emptyMap()) {
    class UnknownSource(id: String) : Refusal("unknown_source", mapOf("source" to id))
    class Busy(module: String) : Refusal("busy", mapOf("module" to module))
    class ConflictRunning(plugin: String) : Refusal("conflict_running", mapOf("plugin" to plugin))
    class FileRequired(id: String) : Refusal("file_required", mapOf("source" to id))
    class BadFile(name: String) : Refusal("bad_file", mapOf("file" to name))
    class UnknownBatch(batch: String) : Refusal("unknown_batch", mapOf("batch" to batch))
    /** [batch]: the batch of an `apply` that stopped midway, to roll back what it wrote. */
    class Failed(message: String, val batch: String? = null) : Refusal("failed", mapOf("error" to message))
}

sealed interface Outcome {
    data class Done(val source: ImporterDeclaration, val batch: String, val report: ImportReport) : Outcome
    data class Refused(val refusal: Refusal) : Outcome
}

/** A run accepted and not started yet: [run] does it (blocking) and frees the module. */
sealed interface Start {
    /** [batch]: the id the run is logged under, known before it ends. */
    class Ready(val batch: String, val run: () -> Outcome) : Start
    data class Refused(val refusal: Refusal) : Start
}

/** A run in progress. [target]: for a rollback, the batch it undoes. */
data class ActiveRun(val batch: String, val source: String, val module: String, val action: String, val startedAt: Long, val target: String?)

/**
 * Runs the modules' importers (ADR `data-imports` §2, §6, §7): one run at a time per module,
 * `apply` refused while a source plugin is enabled, a file only from [importsDir], each run
 * logged with its report. Blocking: call it off the game threads. No Bukkit.
 */
class ImportRuns(
    private val registry: ImportRegistry,
    private val log: ImportRunLog,
    private val importsDir: Path,
    /** The first enabled plugin whose name starts with one of the names (case-insensitive), or null. */
    private val runningPlugin: (List<String>) -> String?,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newBatch: () -> String = { UUID.randomUUID().toString().replace("-", "").take(12) },
    /** A run that threw: what was running, and why. */
    private val onFailure: (String, Throwable) -> Unit = { _, _ -> },
) {
    private val busy = ConcurrentHashMap<String, ActiveRun>()

    fun sources(): List<ImporterDeclaration> = registry.registered()

    /** The runs in progress, one per module at most. */
    fun active(): List<ActiveRun> = busy.values.sortedBy { it.startedAt }

    /** The enabled plugin that stops [source] from being applied, or null. */
    fun conflict(source: ImporterDeclaration): String? = runningPlugin(source.conflicts)

    /** The files an admin can name: plain files directly inside the imports folder. */
    fun files(): List<String> = try {
        Files.list(importsDir).use { s -> s.filter { Files.isRegularFile(it) }.map { it.fileName.toString() }.filter { !it.startsWith(".") }.sorted().toList() }
    } catch (_: java.io.IOException) {
        emptyList()
    }

    /** Dry run, or the write when [confirm]. */
    fun run(sourceId: String, fileName: String?, confirm: Boolean, actor: String, lang: String, options: Map<String, String> = emptyMap()): Outcome =
        finish(prepare(sourceId, fileName, confirm, actor, lang, options))

    /** Undoes an applied [batch]: a dry run, or the write when [confirm]. */
    fun rollback(batch: String, confirm: Boolean, actor: String): Outcome = finish(prepareRollback(batch, confirm, actor))

    private fun finish(start: Start): Outcome = when (start) {
        is Start.Ready -> start.run()
        is Start.Refused -> Outcome.Refused(start.refusal)
    }

    /**
     * Checks a run and takes its module; the caller then calls [Start.Ready.run], on any thread
     * that may block. For a caller that answers before the run ends (the editor).
     */
    fun prepare(sourceId: String, fileName: String?, confirm: Boolean, actor: String, lang: String, options: Map<String, String> = emptyMap()): Start {
        val source = registry.find(sourceId) ?: return Start.Refused(Refusal.UnknownSource(sourceId))
        val file = when {
            fileName != null -> resolve(fileName) ?: return Start.Refused(Refusal.BadFile(fileName))
            source.readsFile -> return Start.Refused(Refusal.FileRequired(sourceId))
            else -> null
        }
        if (confirm) runningPlugin(source.conflicts)?.let { return Start.Refused(Refusal.ConflictRunning(it)) }
        val action = if (confirm) "apply" else "plan"
        return locked(source, action, null, actor) { batch ->
            val request = ImportRequest(batch, file, options, lang)
            val report = if (confirm) source.importer().apply(request) else source.importer().plan(request)
            log.record(ImportRun(batch, source.id, source.module(), action, wrote(report), actor, clock(), null, json(report)))
            Outcome.Done(source, batch, report)
        }
    }

    /** As [prepare], for the rollback of an applied [batch]. */
    fun prepareRollback(batch: String, confirm: Boolean, actor: String): Start {
        val run = log.findApplied(batch) ?: return Start.Refused(Refusal.UnknownBatch(batch))
        val source = registry.find(run.source) ?: return Start.Refused(Refusal.UnknownSource(run.source))
        return locked(source, "rollback", batch, actor) { id ->
            val report = source.importer().rollback(batch, !confirm)
            log.record(ImportRun(id, source.id, source.module(), "rollback", wrote(report), actor, clock(), batch, json(report)))
            Outcome.Done(source, batch, report)
        }
    }

    fun history(limit: Int = 10): List<ImportRun> = log.recent(limit)

    /** Something was written: a run that only skipped what was already imported has no batch to roll back. */
    private fun wrote(report: ImportReport) = !report.isDryRun && report.total() > 0

    /**
     * A run that threw is logged too. A failed `apply` may have written records before it stopped
     * (each in its own transaction): it is logged as applied, so its batch can be rolled back.
     */
    private fun locked(source: ImporterDeclaration, action: String, target: String?, actor: String, block: (String) -> Outcome): Start {
        val batch = newBatch()
        val module = source.module()
        if (busy.putIfAbsent(module, ActiveRun(batch, source.id, module, action, clock(), target)) != null) return Start.Refused(Refusal.Busy(module))
        return Start.Ready(batch) {
            try {
                block(batch)
            } catch (e: Throwable) {
                if (e is VirtualMachineError) throw e
                val message = e.message ?: e.javaClass.simpleName
                onFailure("${source.id} $action", e)
                try {
                    log.record(ImportRun(batch, source.id, module, action, action == "apply", actor, clock(), target, mapper.writeValueAsString(mapOf("failed" to message))))
                } catch (logging: Exception) {
                    onFailure("${source.id} $action (logging its failure)", logging)
                }
                Outcome.Refused(Refusal.Failed(message, batch.takeIf { action == "apply" }))
            } finally {
                busy.remove(module)
            }
        }
    }

    /** A plain file name directly inside [importsDir], existing; null otherwise (no path, no `..`). */
    private fun resolve(name: String): Path? {
        if (name.isBlank() || name.contains('/') || name.contains('\\') || name.startsWith(".")) return null
        val dir = importsDir.toAbsolutePath().normalize()
        val file = dir.resolve(name).normalize()
        return file.takeIf { it.parent == dir && Files.isRegularFile(it) }
    }

    companion object {
        private val mapper = ObjectMapper()

        fun json(report: ImportReport): String = mapper.writeValueAsString(mapOf(
            "dry_run" to report.isDryRun,
            "batch" to report.batch,
            "counts" to report.counts.map { mapOf("kind" to it.kind, "label" to it.label, "count" to it.count) },
            "already_imported" to report.alreadyImported,
            "rejected" to report.rejected.map { mapOf("source_id" to it.sourceId, "code" to it.code, "message" to it.message) },
            "blockers" to report.blockers,
            "notes" to report.notes,
        ))
    }
}
