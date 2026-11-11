package net.artisanmc.plugin.hub

import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * A conversation of the assistant as stored (ADR `editor-assistant`): enough to list it, show it
 * again and let the model go on. [events] is the editor's events as a JSON array; [history] the
 * provider's own history ([AiConversation.history]), valid only under [historyKey].
 */
data class AiConversationRecord(
    val id: String,
    val owner: UUID,
    val project: String?,
    val server: String?,
    val title: String?,
    val createdAt: Instant,
    val lastActive: Instant,
    val inputTokens: Long,
    val outputTokens: Long,
    val events: String = "[]",
    val history: String? = null,
    val historyKey: String? = null,
)

/**
 * Where the assistant's conversations outlive the hub: the suite database, so a restart, a change
 * of its settings or another server of the network finds them again. Every method blocks.
 */
interface AiConversationStore {
    /** Writes [record], replacing the one with its id. */
    fun save(record: AiConversationRecord)

    fun load(id: String): AiConversationRecord?

    /** [owner]'s conversations, without their events nor history. */
    fun list(owner: UUID): List<AiConversationRecord>

    fun delete(id: String)

    /** Forgets the conversations idle since before [before]. */
    fun deleteIdle(before: Instant)
}

class MemoryAiConversationStore : AiConversationStore {
    val records = ConcurrentHashMap<String, AiConversationRecord>()

    override fun save(record: AiConversationRecord) {
        records[record.id] = record
    }

    override fun load(id: String) = records[id]

    override fun list(owner: UUID) = records.values.filter { it.owner == owner }.map { it.copy(events = "[]", history = null) }

    override fun delete(id: String) {
        records.remove(id)
    }

    override fun deleteIdle(before: Instant) {
        records.values.removeIf { it.lastActive.isBefore(before) }
    }
}
