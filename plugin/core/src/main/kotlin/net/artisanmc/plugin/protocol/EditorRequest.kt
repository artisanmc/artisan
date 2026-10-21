package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper

/**
 * What the editor, relayed by the hub, asks the server. A message whose type is
 * unknown or that lacks a required field does not become a request: it is ignored.
 *
 * [Mutation.message] keeps the raw write message: the idempotency fingerprint
 * hashes it verbatim.
 */
sealed interface EditorRequest {
    sealed interface WithReply : EditorRequest {
        val requestId: String
    }

    sealed interface Mutation : WithReply {
        val message: JsonNode
    }

    data class HelloAck(val sessionId: String?, val resourcePack: PackUpdate, val bedrockPack: PackUpdate = PackUpdate.Incomplete) : EditorRequest

    data object SessionReplaced : EditorRequest
    data object CustomItemsRequest : EditorRequest
    data class ResourcePackUpdated(val url: String, val hash: String) : EditorRequest
    data class BedrockPackUpdated(val url: String, val hash: String) : EditorRequest

    data class NexoGlyphsList(override val requestId: String) : WithReply
    data class NexoGlyphRead(override val requestId: String, val glyphId: String?) : WithReply
    data class ServerConfigWrite(override val requestId: String, val changes: Map<String, Any?>) : WithReply
    data class OnlinePlayersFetch(override val requestId: String) : WithReply
    data class PapiPlaceholdersFetch(override val requestId: String) : WithReply
    data class HeadTextureFetch(override val requestId: String, val id: String) : WithReply
    data class PlayerInventoryFetch(override val requestId: String, val player: String) : WithReply
    data class DataSourceFetch(
        override val requestId: String,
        val ref: String,
        val params: Map<String, Any?>,
        val filter: Map<String, Any?>,
        val sort: Map<String, Any?>,
        val limit: Int?,
        val args: Map<String, Any>,
    ) : WithReply

    data class ProjectList(override val requestId: String) : WithReply
    /** [ifHash]: the fingerprint the editor already has; when it equals ours, nothing is sent. */
    data class ProjectRead(override val requestId: String, val projectId: String, val ifHash: String?) : WithReply
    data class ProjectHistory(override val requestId: String, val projectId: String, val path: String) : WithReply
    data class AssetRead(override val requestId: String, val projectId: String, val path: String) : WithReply
    data class ConfigRead(override val requestId: String, val projectId: String, val table: String) : WithReply

    data class ProjectWrite(
        override val requestId: String,
        val projectId: String,
        val operationId: String,
        val writes: List<FileWrite>,
        val deletes: List<FileDelete>,
        val renames: List<FileRename>,
        /** `null`: list present but malformed, rejected as `invalid_path`. */
        val binaries: List<BinaryWrite>?,
        val create: Boolean,
        override val message: JsonNode,
    ) : Mutation

    data class ConfigWrite(
        override val requestId: String,
        val projectId: String,
        val writes: List<Pair<String, String>>,
        val deletes: List<String>,
        override val message: JsonNode,
    ) : Mutation

    data class ProjectCreate(override val requestId: String, val projectId: String) : WithReply
    data class ProjectDelete(override val requestId: String, val projectId: String) : WithReply
    data class ProjectRename(override val requestId: String, val projectId: String, val targetId: String) : WithReply

    /** Drafts parse their own protocol (`ProjectDraftStore`). */
    /** A Draft the hub keeps, to publish: the draft, its new binaries, its author. */
    data class ProjectDraftPublish(override val requestId: String, val projectId: String, override val message: JsonNode) : Mutation

    sealed interface PackUpdate {
        data object Cleared : PackUpdate
        data class Apply(val url: String, val hash: String) : PackUpdate
        data object Incomplete : PackUpdate
    }

    /** `baseHash` null: "I expect the file not to exist". */
    data class FileWrite(val path: String, val content: String, val baseHash: String?)
    data class FileDelete(val path: String, val baseHash: String?)
    data class FileRename(val from: String, val to: String, val baseHash: String?)
    /** `contentBase64` null: delete. */
    data class BinaryWrite(val path: String, val contentBase64: String?, val baseHash: String?)

    companion object {
        private val mapper = ObjectMapper()

        fun parse(node: JsonNode): EditorRequest? {
            val type = node["type"]?.asText() ?: return null
            if (type == "session_replaced") return SessionReplaced
            if (type == "custom_items_request") return CustomItemsRequest
            if (type == "hello_ack") return helloAck(node)
            if (type == "resource_pack_updated") {
                return ResourcePackUpdated(node.text("url") ?: return null, node.text("hash") ?: return null)
            }
            if (type == "bedrock_pack_updated") {
                return BedrockPackUpdated(node.text("url") ?: return null, node.text("hash") ?: return null)
            }

            val requestId = node.text("request_id") ?: return null
            return when (type) {
                "nexo_glyphs_list" -> NexoGlyphsList(requestId)
                "nexo_glyph_read" -> NexoGlyphRead(requestId, node.text("glyph_id"))
                "server_config_write" -> ServerConfigWrite(requestId, objectOrNull(node["changes"]) ?: emptyMap())
                "online_players_fetch" -> OnlinePlayersFetch(requestId)
                "papi_placeholders_fetch" -> PapiPlaceholdersFetch(requestId)
                "head_texture_fetch" -> HeadTextureFetch(requestId, node.text("id") ?: "")
                "player_inventory_fetch" -> PlayerInventoryFetch(requestId, node.text("player") ?: return null)
                "data_source_fetch" -> DataSourceFetch(
                    requestId = requestId,
                    ref = node.text("ref") ?: return null,
                    params = objectField(node, "params"),
                    filter = objectField(node, "filter"),
                    sort = objectField(node, "sort"),
                    limit = node["limit"]?.takeIf { it.isNumber }?.asInt(),
                    args = objectField(node, "args").mapValues { it.value ?: "" },
                )
                "project_list" -> ProjectList(requestId)
                "project_read" -> ProjectRead(requestId, node.text("project_id") ?: return null, node.text("if_hash"))
                "project_history" -> ProjectHistory(
                    requestId, node.text("project_id") ?: return null, node.text("path") ?: return null,
                )
                "asset_read" -> AssetRead(requestId, node.text("project_id") ?: return null, node.text("path") ?: return null)
                "config_read" -> ConfigRead(requestId, node.text("project_id") ?: return null, node.text("table") ?: return null)
                "project_write" -> projectWrite(requestId, node.text("project_id") ?: return null, node)
                "config_write" -> ConfigWrite(
                    requestId = requestId,
                    projectId = node.text("project_id") ?: return null,
                    writes = node.array("files").mapNotNull { f ->
                        (f.text("path") ?: return@mapNotNull null) to (f.text("content") ?: return@mapNotNull null)
                    },
                    deletes = node.array("deletes").mapNotNull { it.asText() },
                    message = node,
                )
                "project_draft_publish" -> ProjectDraftPublish(requestId, node.text("project_id") ?: return null, node)
                "project_create" -> ProjectCreate(requestId, node.text("project_id") ?: return null)
                "project_delete" -> ProjectDelete(requestId, node.text("project_id") ?: return null)
                "project_rename" -> ProjectRename(
                    requestId, node.text("project_id") ?: return null, node.text("target_project_id") ?: return null,
                )
                else -> null
            }
        }

        private fun helloAck(node: JsonNode): HelloAck =
            HelloAck(
                sessionId = node.text("session_id"),
                resourcePack = packUpdate(node["resource_pack"], absent = PackUpdate.Cleared),
                // A hub older than the field says nothing about the Bedrock pack.
                bedrockPack = packUpdate(node["bedrock_pack"], absent = PackUpdate.Incomplete),
            )

        /** `null` clears the pack, an address applies it, an empty object leaves it. */
        private fun packUpdate(pack: JsonNode?, absent: PackUpdate): PackUpdate = when {
            pack == null -> absent
            pack.isNull -> PackUpdate.Cleared
            else -> {
                val url = pack.text("url")
                val hash = pack.text("hash")
                if (url != null && hash != null) PackUpdate.Apply(url, hash) else PackUpdate.Incomplete
            }
        }

        private fun projectWrite(requestId: String, projectId: String, node: JsonNode) = ProjectWrite(
            requestId = requestId,
            projectId = projectId,
            operationId = node.path("operation_id").asText(),
            writes = node.array("files").mapNotNull { f ->
                FileWrite(f.text("path") ?: return@mapNotNull null, f.text("content") ?: return@mapNotNull null, baseHash(f))
            },
            deletes = node.array("deletes").mapNotNull { d -> FileDelete(d.text("path") ?: return@mapNotNull null, baseHash(d)) },
            renames = node.array("renames").mapNotNull { r ->
                FileRename(r.text("from") ?: return@mapNotNull null, r.text("to") ?: return@mapNotNull null, baseHash(r))
            },
            binaries = binaries(node),
            create = node["create"]?.asBoolean() ?: false,
            message = node,
        )

        private fun binaries(node: JsonNode): List<BinaryWrite>? {
            val list = node["binaries"] ?: return emptyList()
            if (!list.isArray) return null
            return list.map { b ->
                val path = b.path("path")
                val content = b["content_base64"]
                val base = b["base_hash"]
                if (!path.isTextual || content == null || !(content.isNull || content.isTextual) ||
                    (base != null && !base.isNull && !base.isTextual)
                ) return null
                BinaryWrite(path.asText(), content.takeIf { !it.isNull }?.asText(), baseHash(b))
            }
        }

        private fun objectField(node: JsonNode, field: String): Map<String, Any?> =
            node[field]?.takeIf { it.isObject }?.let(::objectOrNull) ?: emptyMap()

        private fun objectOrNull(node: JsonNode?): Map<String, Any?>? =
            node?.let { mapper.convertValue(it, object : TypeReference<Map<String, Any?>>() {}) }

        private fun baseHash(node: JsonNode): String? = node.nullableText("base_hash")
        private fun JsonNode.text(field: String): String? = this[field]?.asText()
        private fun JsonNode.nullableText(field: String): String? = this[field]?.takeIf { !it.isNull }?.asText()
        private fun JsonNode.array(field: String): List<JsonNode> = this[field]?.takeIf { it.isArray }?.toList().orEmpty()
    }
}
