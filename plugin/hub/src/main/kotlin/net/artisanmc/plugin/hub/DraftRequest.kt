package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode

/** Where a Draft stands: only an active draft can change; the other two are kept [DraftStorage]-side until purged. */
enum class DraftStatus(val wire: String) {
    ACTIVE("active"), DISCARDED("discarded"), PUBLISHED("published");

    companion object {
        /** Null for a value this release does not know: such a draft reads as closed. */
        fun of(wire: String): DraftStatus? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * A Draft as stored (`artisan-draft/v1`): the JSON document itself, kept whole so that fields
 * this release does not read survive a write, with typed reads of the fields the hub relies on.
 */
class Draft(val json: ObjectNode) {
    val id: String get() = json.path("id").asText()
    val ownerId: String get() = json.path("ownerId").asText()
    val revision: Long get() = json.path("revision").asLong()
    val status: DraftStatus? get() = DraftStatus.of(json.path("status").asText())
    val snapshot: JsonNode? get() = json["snapshot"]
}

/** What an applied operation left: replaying [operationId] answers [result] if the request prints as [fingerprint]. */
data class DraftReceipt(val operationId: String, val fingerprint: String, val result: String)

/** One write of [DraftStorage.commit]: the draft's new [body] and the operation's [receipt], stored together; [owner] and [status] are the body's, kept as columns for the listing. */
data class DraftCommit(val draftId: String, val owner: String, val body: String, val status: DraftStatus, val receipt: DraftReceipt)

/**
 * A `project_draft_request`, parsed once from its wire JSON (the same shape the server gets when
 * the hub has no database). Values are kept as sent: [ProjectDrafts] checks them in its order,
 * so each refusal keeps its code.
 */
sealed interface DraftRequest {
    val ownerId: String

    data class ListDrafts(override val ownerId: String) : DraftRequest

    /** A request on one draft. */
    sealed interface OnDraft : DraftRequest { val draftId: String }

    data class Read(override val ownerId: String, override val draftId: String) : OnDraft
    data class ReadBlob(override val ownerId: String, override val draftId: String, val hash: String) : OnDraft

    /** A write, replayable under its [operationId]. */
    sealed interface Operation : OnDraft { val operationId: String }

    data class Create(
        override val ownerId: String, override val draftId: String, override val operationId: String,
        val name: String, val snapshot: JsonNode?, val source: String,
    ) : Operation

    /** A write on an existing draft, refused unless it was made against its current revision. */
    sealed interface Revised : Operation { val expectedRevision: Long? }

    data class Update(
        override val ownerId: String, override val draftId: String, override val operationId: String, override val expectedRevision: Long?,
        val name: String, val snapshot: JsonNode?,
    ) : Revised

    data class Discard(
        override val ownerId: String, override val draftId: String, override val operationId: String, override val expectedRevision: Long?,
    ) : Revised

    data class WriteBlob(
        override val ownerId: String, override val draftId: String, override val operationId: String, override val expectedRevision: Long?,
        val hash: String, val contentBase64: String,
    ) : Revised

    data class Publish(
        override val ownerId: String, override val draftId: String, override val operationId: String, override val expectedRevision: Long?,
        val authorId: String, val authorName: String,
        /** The AI app publishing for the player, if any: its Version reads "<player> via <app>". */
        val authorVia: String? = null,
    ) : Revised

    companion object {
        /** [node]'s request, for [ownerId]; null when its `action` is not one of the eight. */
        fun parse(node: JsonNode, ownerId: String): DraftRequest? {
            val draft = node.path("draft_id").asText()
            val operation = node.path("operation_id").asText()
            val revision = node.path("expected_revision").takeIf { it.isIntegralNumber }?.asLong()
            return when (node.path("action").asText()) {
                "list" -> ListDrafts(ownerId)
                "read" -> Read(ownerId, draft)
                "read_blob" -> ReadBlob(ownerId, draft, node.path("hash").asText())
                "create" -> Create(ownerId, draft, operation, node.path("name").asText(), node["snapshot"], node.path("source").asText("manual"))
                "update" -> Update(ownerId, draft, operation, revision, node.path("name").asText(), node["snapshot"])
                "discard" -> Discard(ownerId, draft, operation, revision)
                "write_blob" -> WriteBlob(ownerId, draft, operation, revision, node.path("hash").asText(), node.path("content_base64").asText())
                "publish" -> Publish(ownerId, draft, operation, revision, node.path("author_id").asText(""), node.path("author_name").asText(""), node.path("author_via").asText("").ifEmpty { null })
                else -> null
            }
        }
    }
}
