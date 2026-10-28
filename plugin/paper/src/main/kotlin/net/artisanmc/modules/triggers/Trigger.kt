package net.artisanmc.modules.triggers

/**
 * One `triggers/<id>.yml` (`schema: trigger/v1`, ADR `triggers-and-variables` §1), as the
 * dispatcher runs it: the Game event it listens to, its filters and its chain, kept in their
 * wire form (the conditions and the chain are compiled by the core at each run).
 *
 * @property ref the qualified id `project/id`: the run order and the cooldown key.
 */
internal data class Trigger(
    val projectId: String,
    val id: String,
    val on: String,
    val conditions: List<Any?>,
    val cooldownSeconds: Long,
    val enabled: Boolean,
    val chain: Any?,
) {
    val ref: String get() = "$projectId/$id"

    companion object {
        const val KIND = "trigger"
        const val DIR = "triggers"
        const val SCHEMA = "trigger/v1"

        /**
         * The Trigger of a raw Document ([net.artisanmc.modules.api.project.ProjectContentApi.documents]),
         * or the reason it cannot run. Tolerant like the rest of the runtime: an unknown key is
         * ignored, a missing `enabled` is true, a missing `cooldown_seconds` is none.
         */
        fun parse(projectId: String, doc: Map<String, Any?>): Result<Trigger> {
            val id = doc["id"]?.toString().orEmpty()
            val on = (doc["on"] as? String)?.trim().orEmpty()
            if (on.isEmpty()) return Result.failure(IllegalArgumentException("$projectId/$id: no `on:` event"))
            val conditions = when (val c = doc["if"]) {
                null -> emptyList()
                is List<*> -> c
                else -> listOf(c)
            }
            val cooldown = when (val c = doc["cooldown_seconds"]) {
                null -> 0L
                is Number -> c.toLong()
                is String -> c.trim().toLongOrNull()
                    ?: return Result.failure(IllegalArgumentException("$projectId/$id: `cooldown_seconds` is not a number"))
                else -> return Result.failure(IllegalArgumentException("$projectId/$id: `cooldown_seconds` is not a number"))
            }
            val enabled = when (val e = doc["enabled"]) {
                null -> true
                is Boolean -> e
                else -> e.toString().trim().lowercase() != "false"
            }
            return Result.success(Trigger(projectId, id, on, conditions, cooldown.coerceAtLeast(0), enabled, doc["do"]))
        }
    }
}
