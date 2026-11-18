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
    class Failed(message: String) : Refusal("failed", mapOf("error" to message))
}

sealed interface Outcome {
    data class Done(val source: ImporterDeclaration, val batch: String, val report: ImportReport) : Outcome
    data class Refused(val refusal: Refusal) : Outcome
}

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
) {
    private val busy = ConcurrentHashMap.newKeySet<String>()

    fun sources(): List<ImporterDeclaration> = registry.registered()

    /** Dry run, or the write when [confirm]. */
    fun run(sourceId: String, fileName: String?, confirm: Boolean, actor: String, lang: String, options: Map<String, String> = emptyMap()): Outcome {
        val source = registry.find(sourceId) ?: return Outcome.Refused(Refusal.UnknownSource(sourceId))
        val file = when {
            fileName != null -> resolve(fileName) ?: return Outcome.Refused(Refusal.BadFile(fileName))
            source.readsFile -> return Outcome.Refused(Refusal.FileRequired(sourceId))
            else -> null
        }
        if (confirm) runningPlugin(source.conflicts)?.let { return Outcome.Refused(Refusal.ConflictRunning(it)) }
        return locked(source.module()) {
            val batch = newBatch()
            val request = ImportRequest(batch, file, options, lang)
            val report = if (confirm) source.importer().apply(request) else source.importer().plan(request)
            log.record(ImportRun(batch, source.id, source.module(), if (confirm) "apply" else "plan", !report.isDryRun, actor, clock(), null, json(report)))
            Outcome.Done(source, batch, report)
        }
    }

    /** Undoes an applied [batch]: a dry run, or the write when [confirm]. */
    fun rollback(batch: String, confirm: Boolean, actor: String): Outcome {
        val run = log.findApplied(batch) ?: return Outcome.Refused(Refusal.UnknownBatch(batch))
        val source = registry.find(run.source) ?: return Outcome.Refused(Refusal.UnknownSource(run.source))
        return locked(source.module()) {
            val report = source.importer().rollback(batch, !confirm)
            log.record(ImportRun(newBatch(), source.id, source.module(), "rollback", !report.isDryRun, actor, clock(), batch, json(report)))
            Outcome.Done(source, batch, report)
        }
    }

    fun history(limit: Int = 10): List<ImportRun> = log.recent(limit)

    private fun locked(module: String, block: () -> Outcome): Outcome {
        if (!busy.add(module)) return Outcome.Refused(Refusal.Busy(module))
        return try {
            block()
        } catch (e: Exception) {
            Outcome.Refused(Refusal.Failed(e.message ?: e.javaClass.simpleName))
        } finally {
            busy.remove(module)
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
