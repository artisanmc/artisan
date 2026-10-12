package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.ProjectFilesReader
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.util.Base64

/** Caller holds ProjectRoots' monitor. Receipts and staging share the destination filesystem. */
class ProjectCopier(private val roots: ProjectRoots, private val limits: Limits = Limits(), private val now: () -> Long = System::currentTimeMillis, private val onRecoveryFailure: (Throwable) -> Unit = {}) {
    data class Limits(val files: Int = 5000, val totalBytes: Long = 64L * 1024 * 1024, val fileBytes: Long = 16L * 1024 * 1024, val chunkBytes: Int = 192 * 1024, val pending: Int = 8, val stagingTtlMillis: Long = 24L * 60 * 60 * 1000)
    private val mapper = ObjectMapper()
    private val journal = File(roots.coreRoot, ".artisan-copies")
    private val operations = linkedMapOf<String, JsonNode>()
    private val quarantinedTargets = hashSetOf<String>()
    var afterActivationForTesting: (() -> Unit)? = null
    var activationRevision: Long = 0
        private set

    init {
        require(!Files.isSymbolicLink(journal.toPath())) { "invalid_path" }
        journal.listFiles { f -> f.extension == "json" }?.forEach { file ->
            runCatching {
                val op = mapper.readTree(file)
                require(validId(op.path("operation_id").asText()) && validId(op.path("target_id").asText())) { "invalid_path" }
                require(file.name == "${physicalId(op["operation_id"].asText())}.json") { "invalid_journal" }
                require(op.path("state").asText() in setOf("staging", "activating", "activated", "expired")) { "invalid_journal" }
                require(BundleHasher.hashBytes(mapper.writeValueAsBytes(manifest(op))) == op.path("fingerprint").asText()) { "invalid_journal" }
                operations[op["operation_id"].asText()] = op
            }.onFailure { error ->
                runCatching { Regex("\"target_id\"\\s*:\\s*\"([^\"]+)\"").find(file.readText())?.groupValues?.get(1)?.takeIf(::validId)?.let { quarantinedTargets.add(it) } }
                onRecoveryFailure(error)
            }
        }
        operations.values.toList().filter { it.path("state").asText() == "activating" }.forEach { runCatching { activate(it) } }
        operations.values.toList().filter { it.path("state").asText() == "activated" }.forEach { op ->
            runCatching { clearActivationMarker(op) }.onFailure(onRecoveryFailure)
        }
        collectExpired()
    }

    fun isPending(id: String) = quarantinedTargets.any { it.equals(id, ignoreCase = File.separatorChar == '\\') } ||
        File(roots.coreRoot,"$id/.artisan/copy-operation.json").exists() || operations.values.any { it["target_id"].asText().equals(id, ignoreCase = File.separatorChar == '\\') && it["state"].asText() in setOf("staging", "activating") }

    fun handle(request: JsonNode, minecraftVersion: String, modules: Set<String>, beforeCommit: (String, List<String>) -> String? = { _, _ -> null }): Map<String, Any> {
        val id = request.path("operation_id").asText()
        val target = request.path("target_id").asText()
        val fingerprint = request.path("fingerprint").asText()
        val response = mutableMapOf<String, Any>("operation_id" to id, "target_id" to target, "fingerprint" to fingerprint)
        return try {
            collectExpired()
            require(validId(id) && validId(target) && fingerprint.matches(Regex("[a-f0-9]{64}"))) { "invalid_input" }
            var op = operations[id]
            require(op == null || op["target_id"].asText() == target && op["fingerprint"].asText() == fingerprint) { "operation_conflict" }
            require(op?.path("state")?.asText() != "expired") { "operation_expired" }
            if (op?.path("state")?.asText() == "activated" && clearActivationMarker(op!!)) activationRevision++
            when (request.path("action").asText()) {
                "begin" -> {
                    val manifest = manifest(request)
                    require(BundleHasher.hashBytes(mapper.writeValueAsBytes(manifest)) == fingerprint) { "manifest_mismatch" }
                    require(request.path("minecraft_version").asText() == minecraftVersion) { "incompatible_version" }
                    require(request.path("modules").all { it.asText() in modules }) { "missing_module" }
                    if (op == null) {
                        require(operations.values.count { it["state"].asText() in setOf("staging", "activating") } < limits.pending) { "too_many_operations" }
                        require(!isPending(target) && !roots.renamer.isPending(target) && !roots.renamer.isRetired(target)) { "destination_reserved" }
                        require(!roots.isRegistered(target) && !File(roots.coreRoot,target).exists()) { "destination_exists" }
                        op = mapper.valueToTree(manifest + mapOf("operation_id" to id, "fingerprint" to fingerprint, "state" to "staging", "activity_at" to now()))
                        persist(op!!)
                    }
                }
                "chunk" -> {
                    require(op != null) { "unknown_operation" }
                    if (op!!["state"].asText() == "staging") writeChunk(op!!, request)
                }
                "commit" -> {
                    require(op != null) { "unknown_operation" }
                    if (op!!["state"].asText() == "staging") {
                        beforeCommit(target, op!!["files"].map { it["path"].asText() })?.let { error(it) }
                        verify(op!!, tree(id))
                        val marker = ProjectPathPolicy.resolve(tree(id), ".artisan/copy-operation.json")
                        marker.parentFile.mkdirs(); writeSynced(marker, id.toByteArray())
                        op = op!!.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>().put("state", "activating")
                        persist(op!!)
                    }
                    if (op!!["state"].asText() == "activating") activate(op!!)
                }
                "status" -> if (op?.path("state")?.asText() == "activating") activate(op!!)
                else -> error("invalid_input")
            }
            val current = operations[id]
            val state = current?.path("state")?.asText() ?: "missing"
            response["ok"] = true
            response["state"] = if (state == "activating") "staging" else state
            if (state == "activated") response["file_hashes"] = current!!["files"].associate { it["path"].asText() to it["sha256"].asText() }
            response
        } catch (e: Exception) {
            response["ok"] = false
            response["error"] = if (e is IllegalArgumentException || e is IllegalStateException) e.message ?: "copy_error" else "copy_error"
            response["state"] = if (operations[id]?.path("state")?.asText() in setOf("staging", "activating")) "staging" else "missing"
            response
        }
    }

    private fun manifest(request: JsonNode): Map<String, Any> {
        val files = request.path("files")
        require(files.isArray && files.size() in 1..limits.files && request.path("modules").isArray && request["modules"].size() <= 256) { "invalid_input" }
        val seen = hashSetOf<String>()
        var total = 0L
        val descriptors = files.map { file ->
            val path = file.path("path").asText()
            require(publicPath(path) && seen.add(path.lowercase())) { "invalid_path" }
            val size = file.path("size")
            require(size.isIntegralNumber && size.canConvertToLong() && size.asLong() in 0..limits.fileBytes) { "file_too_large" }
            total += size.asLong(); require(total <= limits.totalBytes) { "too_large" }
            val hash = file.path("sha256").asText(); require(hash.matches(Regex("[a-f0-9]{64}"))) { "invalid_input" }
            linkedMapOf<String, Any>("path" to path, "size" to size.asLong(), "sha256" to hash)
        }.sortedBy { it["path"] as String }
        seen.forEach { path -> require(path.split('/').dropLast(1).indices.none { index -> path.split('/').take(index + 1).joinToString("/") in seen }) { "invalid_path" } }
        require("manifest.yaml" in seen) { "invalid_manifest" }
        require(request["modules"].all { it.isTextual && it.asText().length in 1..128 }) { "invalid_input" }
        return linkedMapOf("target_id" to request["target_id"].asText(), "minecraft_version" to request.path("minecraft_version").asText(), "modules" to request["modules"].map { it.asText() }.sorted(), "files" to descriptors)
    }

    private fun writeChunk(op: JsonNode, request: JsonNode) {
        val path = request.path("path").asText()
        val descriptor = op["files"].firstOrNull { it["path"].asText() == path } ?: error("invalid_path")
        val encoded = request.path("content_base64").asText()
        require(encoded.length <= ((limits.chunkBytes + 2) / 3) * 4) { "chunk_too_large" }
        val bytes = try { Base64.getDecoder().decode(encoded) } catch (_: IllegalArgumentException) { error("invalid_input") }
        require(bytes.size <= limits.chunkBytes && Base64.getEncoder().encodeToString(bytes) == encoded) { "invalid_input" }
        val offsetNode = request.path("offset")
        require(offsetNode.isIntegralNumber && offsetNode.canConvertToLong()) { "invalid_input" }
        val offset = offsetNode.asLong()
        require(offset >= 0 && offset <= descriptor["size"].asLong() - bytes.size) { "invalid_offset" }
        val file = ProjectPathPolicy.resolve(tree(op["operation_id"].asText()),path)
        file.parentFile.mkdirs()
        RandomAccessFile(file,"rw").use { stream ->
            require(offset <= stream.length()) { "invalid_offset" }
            val overlap = minOf(stream.length() - offset, bytes.size.toLong()).toInt()
            if (overlap > 0) {
                val previous = ByteArray(overlap); stream.seek(offset); stream.readFully(previous)
                require(previous.indices.all { previous[it] == bytes[it] }) { "chunk_conflict" }
            }
            if (overlap < bytes.size) {
                stream.seek(offset + overlap); stream.write(bytes,overlap,bytes.size - overlap); stream.fd.sync()
                persist(op.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>().put("activity_at",now()))
            }
        }
    }

    private fun verify(op: JsonNode, dir: File) {
        val expected = op["files"].map { it["path"].asText() }.toSet()
        dir.walkTopDown().forEach { entry ->
            require(!Files.isSymbolicLink(entry.toPath())) { "invalid_path" }
            if (entry.isFile) require(entry.relativeTo(dir).invariantSeparatorsPath in expected + ".artisan/copy-operation.json") { "manifest_mismatch" }
        }
        op["files"].forEach { descriptor ->
            val path = descriptor["path"].asText(); val file = ProjectPathPolicy.resolve(dir,path)
            if (descriptor["size"].asLong() == 0L && !file.exists()) { file.parentFile.mkdirs(); writeSynced(file,byteArrayOf()) }
            require(file.isFile && file.length() == descriptor["size"].asLong()) { "incomplete" }
            val bytes = file.readBytes(); require(BundleHasher.hashBytes(bytes) == descriptor["sha256"].asText()) { "hash_mismatch" }
            if (!ProjectFilesReader.isBinary(path)) {
                try { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)) }
                catch (_: java.nio.charset.CharacterCodingException) { error("invalid_utf8") }
            }
        }
    }

    private fun activate(op: JsonNode) {
        val id = op["operation_id"].asText(); val targetId = op["target_id"].asText()
        val source = tree(id); val target = File(roots.coreRoot,targetId)
        require(!roots.isRegistered(targetId) && !roots.renamer.isPending(targetId) && !roots.renamer.isRetired(targetId)) { "destination_reserved" }
        if (source.exists()) {
            require(!target.exists()) { "destination_exists" }
            verify(op,source)
            Files.move(source.toPath(),target.toPath(),ATOMIC_MOVE)
            syncDirectory(roots.coreRoot)
            syncDirectory(journal)
            afterActivationForTesting?.invoke()
        }
        val marker = ProjectPathPolicy.resolve(target,".artisan/copy-operation.json")
        require(target.isDirectory && marker.isFile && marker.readText() == id) { "activation_unconfirmed" }
        verify(op,target)
        persist(op.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>().put("state","activated"))
        clearActivationMarker(op)
        activationRevision++
    }

    private fun clearActivationMarker(op: JsonNode): Boolean {
        val target = File(roots.coreRoot,op["target_id"].asText())
        val marker = ProjectPathPolicy.resolve(target,".artisan/copy-operation.json")
        if (!marker.exists()) return false
        require(marker.isFile && marker.readText() == op["operation_id"].asText()) { "activation_unconfirmed" }
        // A durable activated receipt proves verification; published files may have changed since.
        Files.delete(marker.toPath())
        syncDirectory(marker.parentFile)
        return true
    }

    private fun persist(op: JsonNode) {
        journal.mkdirs()
        val id = op["operation_id"].asText(); val physical = physicalId(id); val temporary = File(journal,"$physical.tmp")
        writeSynced(temporary,mapper.writeValueAsBytes(op))
        Files.move(temporary.toPath(),File(journal,"$physical.json").toPath(),ATOMIC_MOVE,REPLACE_EXISTING)
        syncDirectory(journal)
        operations[id] = op
    }
    private fun collectExpired() {
        operations.values.toList().forEach { op ->
            if (op["state"].asText() == "staging" && now() - op.path("activity_at").asLong() >= limits.stagingTtlMillis) {
                persist(op.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>().put("state","expired"))
            }
            if (operations[op["operation_id"].asText()]?.path("state")?.asText() == "expired") {
                val dir = tree(op["operation_id"].asText())
                require(dir.canonicalFile.parentFile == journal.canonicalFile) { "invalid_path" }
                if (dir.exists()) Files.walk(dir.toPath()).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.delete(it) } }
            }
        }
    }
    private fun physicalId(id: String) = BundleHasher.hashContent(id)
    private fun tree(id: String): File = ProjectPathPolicy.resolve(journal,"${physicalId(id)}.tree")
    private fun writeSynced(file: File, bytes: ByteArray) = FileOutputStream(file).use { it.write(bytes); it.fd.sync() }
    private fun syncDirectory(dir: File) {
        // Windows does not support opening directories as FileChannels. File contents still use fd.sync().
        if (File.separatorChar != '\\') java.nio.channels.FileChannel.open(dir.toPath(),java.nio.file.StandardOpenOption.READ).use { it.force(true) }
    }
    private fun validId(id: String) = id.matches(Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")) && ProjectPathPolicy.valid(id)
    private fun publicPath(path: String) = ProjectPathPolicy.valid(path) && path.split('/').none { it.startsWith(".artisan",true) } || path == ".artisan/editor.yaml"
}
