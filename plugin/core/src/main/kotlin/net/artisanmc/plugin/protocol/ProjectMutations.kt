package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.project.ProjectPublisher
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ResourceInventory
import net.artisanmc.plugin.project.ResourceQuota
import net.artisanmc.plugin.sync.BundleHasher
import java.io.File
import java.util.UUID

/**
 * What every editor write shares: idempotency by `operation_id` (a replayed message
 * returns the reply already given) and the commercial quota.
 */
internal class ProjectMutations(private val roots: ProjectRoots) {
    private val mapper = ObjectMapper()

    private fun fingerprint(message: JsonNode): String =
        BundleHasher.hashBytes(mapper.writeValueAsBytes(message.deepCopy<ObjectNode>().also { it.remove("request_id") }))

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

    /** Reason for the commercial refusal, or null if the write goes through. */
    fun quotaDenial(
        message: JsonNode,
        projectId: String,
        files: List<String>,
        deletes: List<String>,
        renames: List<Pair<String, String>> = emptyList(),
    ): String? {
        val policy = message["commercial_policy"] ?: return null
        if (!policy.path("enabled").asBoolean(false)) return null
        val quotaNode = policy["quota"] ?: return "inventory_unavailable"
        val quota = if (quotaNode.isNull) null else {
            if (!quotaNode.isIntegralNumber || !quotaNode.canConvertToInt() || quotaNode.intValue() < 0) return "inventory_unavailable"
            quotaNode.intValue()
        }
        val inventory = try { ResourceInventory.scan(roots) } catch (_: Exception) { return "inventory_unavailable" }
        return ResourceQuota.assess(quota, inventory, projectId, roots.isRegistered(projectId), files, deletes, renames)
    }

    /** Replies with the quota refusal, if any. */
    fun deniedByQuota(
        reply: Replies.Reply,
        message: JsonNode,
        projectId: String,
        files: List<String>,
        deletes: List<String>,
        renames: List<Pair<String, String>> = emptyList(),
    ): Boolean {
        val denial = quotaDenial(message, projectId, files, deletes, renames) ?: return false
        reply.error(if (denial == "inventory_unavailable") "inventory_unavailable" else "quota_denied", denial)
        return true
    }
}
