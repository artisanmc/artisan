package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper

/**
 * Ce que l'éditeur, relayé par le backend, demande au serveur. Un message dont le
 * type est inconnu ou dont un champ obligatoire manque ne devient pas une requête :
 * il est ignoré, comme avant le typage.
 *
 * [Mutation.message] garde le message brut des écritures : l'empreinte
 * d'idempotence le hache tel quel, et la politique commerciale y est lue.
 */
sealed interface EditorRequest {
    sealed interface WithReply : EditorRequest {
        val requestId: String
    }

    sealed interface Mutation : WithReply {
        val message: JsonNode
    }

    data class HelloAck(
        val sessionId: String?,
        val bundleUrl: String?,
        val editorUrl: String?,
        val networkName: String?,
        val resourcePack: PackUpdate,
    ) : EditorRequest

    data class DraftUpdate(val menuId: String, val menuYaml: String) : EditorRequest
    data object SessionReplaced : EditorRequest
    data object CustomItemsRequest : EditorRequest
    data class ResourcePackUpdated(val url: String, val hash: String) : EditorRequest
    data class ProjectDeleted(val projectId: String) : EditorRequest
    data object Ping : EditorRequest

    data class ImportSourcesList(override val requestId: String) : WithReply
    /** `null` : sélection mal formée, refusée en `invalid_input`. */
    data class ImportSourcesRead(override val requestId: String, val selections: List<Selection>?) : WithReply
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
    /** [ifHash] : l'empreinte que l'éditeur possède déjà ; égale à la nôtre, rien ne voyage. */
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
        /** `null` : liste présente mais mal formée, refusée en `invalid_path`. */
        val binaries: List<BinaryWrite>?,
        val create: Boolean,
        override val message: JsonNode,
    ) : Mutation

    data class AssetWrite(
        override val requestId: String,
        val projectId: String,
        val writes: List<BinaryWrite>,
        override val message: JsonNode,
    ) : Mutation

    data class ConfigWrite(
        override val requestId: String,
        val projectId: String,
        val writes: List<Pair<String, String>>,
        val deletes: List<String>,
        override val message: JsonNode,
    ) : Mutation

    /** La copie et les brouillons lisent eux-mêmes leur protocole (`ProjectCopier`, `ProjectDraftStore`). */
    data class ProjectCopy(override val requestId: String, override val message: JsonNode) : Mutation
    data class ProjectDraft(override val requestId: String, val projectId: String, override val message: JsonNode) : Mutation

    data class ProjectRename(
        override val requestId: String,
        val operationId: String,
        val projectId: String,
        val targetProjectId: String,
    ) : WithReply

    sealed interface PackUpdate {
        data object Cleared : PackUpdate
        data class Apply(val url: String, val hash: String) : PackUpdate
        data object Incomplete : PackUpdate
    }

    data class Selection(val sourceId: String, val paths: List<String>)

    /** `baseHash` null : « je m'attends à ce que le fichier n'existe pas ». */
    data class FileWrite(val path: String, val content: String, val baseHash: String?)
    data class FileDelete(val path: String, val baseHash: String?)
    data class FileRename(val from: String, val to: String, val baseHash: String?)
    /** `contentBase64` null : suppression. */
    data class BinaryWrite(val path: String, val contentBase64: String?, val baseHash: String?)

    companion object {
        private val mapper = ObjectMapper()

        fun parse(node: JsonNode): EditorRequest? {
            val type = node["type"]?.asText() ?: return null
            if (type == "session_replaced") return SessionReplaced
            if (type == "custom_items_request") return CustomItemsRequest
            if (type == "ping") return Ping
            if (type == "hello_ack") return helloAck(node)
            if (type == "draft_update") {
                return DraftUpdate(node.text("menu_id") ?: return null, node.text("menu_yaml") ?: return null)
            }
            if (type == "resource_pack_updated") {
                return ResourcePackUpdated(node.text("url") ?: return null, node.text("hash") ?: return null)
            }
            if (type == "project_deleted") return ProjectDeleted(node.text("project_id") ?: return null)

            val requestId = node.text("request_id") ?: return null
            return when (type) {
                "import_sources_list" -> ImportSourcesList(requestId)
                "import_sources_read" -> ImportSourcesRead(requestId, selections(node["selections"]))
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
                "asset_write" -> AssetWrite(requestId, node.text("project_id") ?: return null, assetWrites(node), node)
                "config_write" -> ConfigWrite(
                    requestId = requestId,
                    projectId = node.text("project_id") ?: return null,
                    writes = node.array("files").mapNotNull { f ->
                        (f.text("path") ?: return@mapNotNull null) to (f.text("content") ?: return@mapNotNull null)
                    },
                    deletes = node.array("deletes").mapNotNull { it.asText() },
                    message = node,
                )
                "project_copy" -> ProjectCopy(requestId, node)
                "project_draft_request" -> ProjectDraft(requestId, node.text("project_id") ?: return null, node)
                "project_rename" -> ProjectRename(
                    requestId = requestId,
                    operationId = node.text("operation_id") ?: return null,
                    projectId = node.text("project_id") ?: return null,
                    targetProjectId = node.text("target_project_id") ?: return null,
                )
                else -> null
            }
        }

        private fun helloAck(node: JsonNode): HelloAck {
            val pack = node["resource_pack"]
            val update = when {
                pack == null || pack.isNull -> PackUpdate.Cleared
                else -> {
                    val url = pack.text("url")
                    val hash = pack.text("hash")
                    if (url != null && hash != null) PackUpdate.Apply(url, hash) else PackUpdate.Incomplete
                }
            }
            return HelloAck(
                sessionId = node.text("session_id"),
                bundleUrl = node.text("bundle_url") ?: node.text("api_url"),
                editorUrl = node.text("server_url") ?: node.text("editor_url"),
                networkName = node.text("network_name"),
                resourcePack = update,
            )
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

        private fun assetWrites(node: JsonNode): List<BinaryWrite> {
            val files = node["files"]?.takeIf { it.isArray }
                ?: return listOfNotNull(node.text("path")?.let { BinaryWrite(it, node.nullableText("content_base64"), baseHash(node)) })
            return files.mapNotNull { f ->
                BinaryWrite(f.text("path") ?: return@mapNotNull null, f.nullableText("content_base64"), baseHash(f))
            }
        }

        private fun selections(node: JsonNode?): List<Selection>? {
            if (node?.isArray != true) return null
            val parsed = node.mapNotNull { selection ->
                val sourceId = selection["source_id"]?.takeIf { it.isTextual }?.asText() ?: return@mapNotNull null
                val pathsNode = selection["paths"]?.takeIf { it.isArray } ?: return@mapNotNull null
                val paths = pathsNode.mapNotNull { it.takeIf { path -> path.isTextual }?.asText() }
                if (paths.size != pathsNode.size()) null else Selection(sourceId, paths)
            }
            return parsed.takeIf { it.size == node.size() }
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
