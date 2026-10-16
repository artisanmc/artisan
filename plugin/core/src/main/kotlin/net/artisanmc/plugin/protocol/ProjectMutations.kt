package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.project.ProjectPublisher
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ContentHash
import java.io.File
import java.util.UUID

/**
 * What every editor write shares: idempotency by `operation_id` (a replayed message
 * returns the reply already given).
 */
internal class ProjectMutations(private val roots: ProjectRoots) {
    private val mapper = ObjectMapper()

    private fun fingerprint(message: JsonNode): String =
        ContentHash.hashBytes(mapper.writeValueAsBytes(message.deepCopy<ObjectNode>().also { it.remove("request_id") }))

    /** True if [message] was already applied: the original reply is sent again. */
    fun replayed(projectDir: File, message: JsonNode, reply: Replies.Reply): Boolean {
        val publisher = ProjectPublisher(projectDir)
        publisher.recover()
        val operationId = message["operation_id"]?.asText() ?: return false
        val result = publisher.previous(operationId, fingerprint(message)) ?: return false
        @Suppress("UNCHECKED_CAST")
        reply.send(mapper.convertValue(result, Map::class.java) as Map<String, Any?>)
        return true
    }

    fun commit(projectDir: File, message: JsonNode, changes: Map<String, ByteArray?>) {
        ProjectPublisher(projectDir).commit(
            message["operation_id"]?.asText() ?: UUID.randomUUID().toString(), fingerprint(message), changes,
            mapper.valueToTree(mapOf("ok" to true)),
        )
    }
}
