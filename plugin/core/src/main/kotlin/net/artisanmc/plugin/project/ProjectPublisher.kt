package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption.*
import net.artisanmc.plugin.project.ContentHash

/** Caller holds ProjectRoots' monitor. Replay finishes an accepted lot before any runtime read. */
class ProjectPublisher(private val root: File, private val afterApply: (Int) -> Unit = {}) {
    private val mapper = ObjectMapper()
    private fun journal(id: String) = ProjectPathPolicy.resolve(root, ".artisan/transactions/${ContentHash.hashContent(id)}")
    private fun receipt(key: String) = ProjectPathPolicy.resolve(root, ".artisan/transactions/.receipts/$key/intent.json")
    private fun journalFile(dir: File, name: String) = ProjectPathPolicy.resolve(root, "${dir.relativeTo(root).invariantSeparatorsPath}/$name")

    fun previous(id: String, fingerprint: String): JsonNode? {
        val archived = receipt(ContentHash.hashContent(id))
        val file = if (archived.isFile) archived else journalFile(journal(id), "intent.json")
        if (!file.isFile) return null
        val intent = mapper.readTree(file)
        require(intent["fingerprint"].asText() == fingerprint) { "operation_conflict" }
        if (file == archived) check(intent.path("complete").asBoolean()) { "invalid_receipt" }
        else replay(file, intent)
        return intent["result"]
    }

    fun commit(id: String, fingerprint: String, changes: Map<String, ByteArray?>, result: JsonNode): JsonNode {
        previous(id, fingerprint)?.let { return it }
        validateChanges(changes)
        val dir = journal(id)
        dir.mkdirs()
        val entries = changes.entries.mapIndexed { index, (path, bytes) ->
            if (bytes != null) durableWrite(journalFile(dir, "$index.blob"), bytes)
            mapOf("path" to path, "blob" to if (bytes == null) null else "$index.blob")
        }
        val intent = mapper.valueToTree<JsonNode>(mapOf("fingerprint" to fingerprint, "changes" to entries, "result" to result, "complete" to false))
        val file = journalFile(dir, "intent.json")
        durableWrite(file, mapper.writeValueAsBytes(intent))
        replay(file, intent)
        return result
    }

    /** Reject structurally impossible lots before writing the durable commit intent. */
    private fun validateChanges(changes: Map<String, ByteArray?>) {
        val targets = changes.keys.map { ProjectPathPolicy.resolve(root, it).canonicalFile.toPath() }
        targets.withIndex().groupBy { it.value }.values.filter { it.size > 1 }.forEach { aliases ->
            // A case-only rename deletes the old spelling before writing the new one.
            val values = changes.values.toList()
            require(aliases.dropLast(1).all { values[it.index] == null } && values[aliases.last().index] != null) { "invalid_path" }
        }
        val targetSet = targets.toSet()
        targets.forEach { target ->
            val file = target.toFile()
            require(!file.isDirectory) { "invalid_path" }
            var parent = target.parent
            val base = root.canonicalFile.toPath()
            while (parent != null && parent.startsWith(base)) {
                require(parent !in targetSet && !parent.toFile().isFile) { "invalid_path" }
                parent = parent.parent
            }
        }
    }

    fun recover() {
        val dir = ProjectPathPolicy.resolve(root, ".artisan/transactions")
        dir.listFiles()?.filter { it.name != ".receipts" && it.isDirectory }?.sortedBy { it.name }?.forEach {
            ProjectPathPolicy.resolve(root, ".artisan/transactions/${it.name}/intent.json")
            val file = File(it, "intent.json")
            if (file.isFile) replay(file, mapper.readTree(file))
        }
        val revocations = ProjectPathPolicy.resolve(root, ".artisan/drafts/.revoked")
        revocations.listFiles()?.filter { it.isFile }?.forEach { marker ->
            val owner = ProjectPathPolicy.resolve(root, ".artisan/drafts/.revoked/${marker.name}").readText()
            require(ContentHash.hashContent(owner) == marker.name) { "invalid_revocation" }
            val drafts = ProjectPathPolicy.resolve(root, ".artisan/drafts")
            drafts.listFiles()?.filter { it.isDirectory && !it.name.startsWith('.') }?.forEach { draftDir ->
                val envelope = ProjectPathPolicy.resolve(root, ".artisan/drafts/${draftDir.name}/draft.json")
                if (envelope.isFile && mapper.readTree(envelope).path("ownerId").asText() == owner) {
                    val targets = draftDir.walkTopDown().filter { it.isFile }.map {
                        ProjectPathPolicy.resolve(root, it.relativeTo(root).invariantSeparatorsPath)
                    }.toList()
                    targets.forEach { Files.deleteIfExists(it.toPath()) }
                }
            }
            forgetOwner(owner)
        }
    }

    fun forgetOwner(owner: String) {
        val dir = ProjectPathPolicy.resolve(root, ".artisan/transactions")
        val receipts = ProjectPathPolicy.resolve(root, ".artisan/transactions/.receipts")
        val operations = dir.listFiles().orEmpty().filter { it.name != ".receipts" } + receipts.listFiles().orEmpty()
        operations.filter { it.isDirectory }.forEach { operation ->
            val file = journalFile(operation, "intent.json")
            if (file.isFile) {
                val intent = mapper.readTree(file)
                if (intent.path("result").path("draft").path("ownerId").asText() == owner) {
                    check(intent.path("complete").asBoolean()) { "pending_operation" }
                    (intent as com.fasterxml.jackson.databind.node.ObjectNode).set<JsonNode>("result", mapper.valueToTree(mapOf("ok" to false, "error" to "owner_revoked")))
                    durableWrite(file, mapper.writeValueAsBytes(intent))
                }
            }
        }
    }

    /**
     * `.artisan/history/` is no longer fed; existing archives stay readable through
     * `project_history`.
     */
    fun withHistory(changes: Map<String, ByteArray?>): Map<String, ByteArray?> = changes

    private fun replay(file: File, intent: JsonNode) {
        if (intent["complete"].asBoolean()) {
            archive(file)
            return
        }
        intent["changes"].forEachIndexed { index, entry ->
            val target = ProjectPathPolicy.resolve(root, entry["path"].asText())
            if (entry["blob"].isNull) Files.deleteIfExists(target.toPath())
            else {
                val blobName = entry["blob"].asText()
                require(blobName.matches(Regex("[0-9]+\\.blob"))) { "invalid_journal" }
                durableWrite(target, journalFile(file.parentFile, blobName).readBytes())
            }
            afterApply(index)
        }
        intent["changes"].filter { it["blob"].isNull }.forEach { entry ->
            var parent = ProjectPathPolicy.resolve(root, entry["path"].asText()).parentFile
            while (parent != root.absoluteFile && parent != root && parent.isDirectory && parent.list()?.isEmpty() == true) {
                Files.deleteIfExists(parent.toPath())
                parent = parent.parentFile
            }
        }
        (intent as com.fasterxml.jackson.databind.node.ObjectNode).put("complete", true)
        durableWrite(file, mapper.writeValueAsBytes(intent))
        archive(file)
    }

    /** Keep retry receipts, but never scan completed operations on ordinary reads. */
    private fun archive(file: File) {
        file.parentFile.listFiles { f -> f.extension == "blob" }?.forEach { Files.deleteIfExists(it.toPath()) }
        val destination = receipt(file.parentFile.name).parentFile
        destination.parentFile.mkdirs()
        Files.move(file.parentFile.toPath(), destination.toPath(), ATOMIC_MOVE)
    }

    companion object {
        fun durableWrite(target: File, bytes: ByteArray) {
            target.parentFile.mkdirs()
            val temporary = Files.createTempFile(target.parentFile.toPath(), ".artisan-write-", ".tmp").toFile()
            try {
                FileOutputStream(temporary).use { it.write(bytes); it.fd.sync() }
                Files.move(temporary.toPath(), target.toPath(), ATOMIC_MOVE, REPLACE_EXISTING)
            } finally { Files.deleteIfExists(temporary.toPath()) }
        }
    }
}
