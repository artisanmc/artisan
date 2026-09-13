package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE

/** A journal outside project trees keeps directory renames recoverable across lost ACKs. */
class ProjectRenamer(private val roots: ProjectRoots, private val onRecoveryFailure: (String, Throwable) -> Unit = { _, _ -> }) {
    private val mapper = ObjectMapper()
    private val journalDir = File(roots.coreRoot, ".artisan-renames")
    private data class Operation(val id: String, val source: String, val target: String, val complete: Boolean)
    private val operations = linkedMapOf<String, Operation>()

    init {
        journalDir.listFiles { f -> f.isFile && f.extension == "json" }?.sortedBy { it.name }?.forEach { file ->
            val json = mapper.readTree(file)
            val op = Operation(json["operation_id"].asText(), json["project_id"].asText(), json["target_project_id"].asText(), json["complete"].asBoolean())
            require(validId(op.id) && validId(op.source) && validId(op.target)) { "Invalid rename journal ${file.name}" }
            operations[op.id] = op
        }
        operations.values.toList().filterNot { it.complete }.forEach { op ->
            runCatching { finish(op) }.onFailure { onRecoveryFailure(op.id, it) }
        }
    }

    private fun sameIdentity(a: String, b: String): Boolean = a.equals(b, ignoreCase = File.separatorChar == '\\')

    fun isRetired(projectId: String): Boolean {
        val isCurrentCaseRenameTarget = operations.values.any {
            it.complete && sameIdentity(it.source, projectId) && it.target == projectId &&
                roots.coreRoot.listFiles()?.any { file -> file.name == projectId } == true
        }
        return !isCurrentCaseRenameTarget && operations.values.any { sameIdentity(it.source, projectId) }
    }

    fun isPending(projectId: String): Boolean = operations.values.any { !it.complete && (sameIdentity(it.source, projectId) || sameIdentity(it.target, projectId)) }

    fun mutationError(projectId: String): String? = when {
        roots.copier.isPending(projectId) -> "copy_pending"
        isPending(projectId) -> "rename_pending"
        isRetired(projectId) -> "project_renamed"
        else -> null
    }

    fun completed(): List<Map<String, String>> = operations.values.filter { it.complete }.map {
        mapOf("operation_id" to it.id, "project_id" to it.source, "target_project_id" to it.target)
    }

    /** Caller holds the shared roots monitor, also used by file and asset writers. */
    fun rename(operationId: String, source: String, target: String): String? {
        if (!validId(operationId) || !validId(source) || !validId(target) || source == target) return "invalid_path"
        operations[operationId]?.let { previous ->
            if (previous.source != source || previous.target != target) return "operation_conflict"
            if (!previous.complete) finish(previous)
            return null
        }
        if (isPending(source)) return "rename_pending"
        if (isPending(target)) return "destination_reserved"
        if (roots.copier.isPending(source) || roots.copier.isPending(target)) return "destination_reserved"
        if (roots.isRegistered(source)) return "addon_owned"
        val sourceDir = File(roots.coreRoot, source)
        val targetDir = File(roots.coreRoot, target)
        val sameFile = source.equals(target, ignoreCase = true) && sourceDir.exists() && targetDir.exists() && Files.isSameFile(sourceDir.toPath(), targetDir.toPath())
        if (roots.isRegistered(target) || (targetDir.exists() && !sameFile)) return "destination_exists"
        if (isRetired(source)) return "project_renamed"
        if (isRetired(target)) return "destination_reserved"
        if (!sourceDir.isDirectory) return "unknown_project"
        if (Files.isSymbolicLink(sourceDir.toPath()) || sourceDir.canonicalFile.parentFile != roots.coreRoot.canonicalFile) return "invalid_path"
        val op = Operation(operationId, source, target, false)
        persist(op)
        operations[op.id] = op
        finish(op)
        return null
    }

    private fun finish(op: Operation) {
        val source = File(roots.coreRoot, op.source)
        val target = File(roots.coreRoot, op.target)
        val staging = File(journalDir, "${op.id}.tree")
        val sourceExists = roots.coreRoot.listFiles()?.any { it.name == op.source } == true
        if (sourceExists && !staging.exists()) {
            check(!target.exists() || (op.source.equals(op.target, ignoreCase = true) && Files.isSameFile(source.toPath(), target.toPath()))) { "Rename destination occupied: ${op.target}" }
            val marker = File(source, ".artisan/rename-operation.json")
            check(marker.canonicalFile.toPath().startsWith(source.canonicalFile.toPath())) { "Invalid rename marker path" }
            marker.parentFile.mkdirs()
            FileOutputStream(marker).use { stream -> stream.write(op.id.toByteArray()); stream.fd.sync() }
            Files.move(source.toPath(), staging.toPath(), ATOMIC_MOVE)
        }
        if (staging.exists()) {
            check(!target.exists()) { "Rename destination occupied: ${op.target}" }
            Files.move(staging.toPath(), target.toPath(), ATOMIC_MOVE)
        }
        check(target.isDirectory && roots.coreRoot.listFiles()?.none { it.name == op.source } == true) { "Rename files missing: ${op.id}" }
        val marker = File(target, ".artisan/rename-operation.json")
        check(marker.isFile && marker.readText() == op.id) { "Rename destination ownership unconfirmed: ${op.id}" }
        val done = op.copy(complete = true)
        persist(done)
        operations[op.id] = done
        marker.delete()
    }

    private fun persist(op: Operation) {
        journalDir.mkdirs()
        val temp = File(journalDir, "${op.id}.tmp")
        FileOutputStream(temp).use { stream ->
            stream.write(mapper.writeValueAsBytes(mapOf("operation_id" to op.id, "project_id" to op.source, "target_project_id" to op.target, "complete" to op.complete)))
            stream.fd.sync()
        }
        Files.move(temp.toPath(), File(journalDir, "${op.id}.json").toPath(), ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    }

    private fun validId(id: String): Boolean = id.matches(Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")) &&
        !id.matches(Regex("(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])"))
}
