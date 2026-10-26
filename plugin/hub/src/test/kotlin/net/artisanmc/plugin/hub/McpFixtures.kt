package net.artisanmc.plugin.hub

import net.artisanmc.plugin.protocol.ServerLink
import java.util.concurrent.CompletableFuture

/** A hub's world for the MCP and assistant tests: one server with a shop Project, drafts in memory. */
object McpFixtures {
    /** Server `u-local`: [sent] records each message; a file saying `bad` fails its check. */
    fun server(sent: MutableList<Map<String, Any?>>): EditorServer = object : EditorServer {
        override val id = "u-local"
        override val online = true
        override val link = ServerLink { message ->
            sent += message
            val reply = when (message["type"]) {
                "project_list" -> mapOf("ok" to true, "project_ids" to listOf("shop"))
                "project_read" -> mapOf(
                    "ok" to true, "hash" to "h1",
                    "files" to listOf(mapOf("path" to "menus/shop.yml", "content" to "schema: menu/v1\n"), mapOf("path" to "lang/en.yml", "content" to "a: b\n")),
                    "failed" to emptyList<Any>(), "binaries" to emptyList<Any>(),
                )
                // The server's check: a file saying `bad` does not load.
                "documents_check" -> {
                    @Suppress("UNCHECKED_CAST")
                    val files = message["files"] as List<Map<String, String>>
                    mapOf("ok" to true, "problems" to files.filter { "bad" in it.getValue("content") }
                        .map { mapOf("path" to it["path"], "stage" to "schema", "message" to "\$.bad: is not defined in the schema") })
                }
                else -> mapOf("ok" to false, "error" to "unexpected")
            }
            CompletableFuture.completedFuture(mapOf("type" to "${message["type"]}_result") + reply)
        }
        override val label = "Survie"
        override val minecraftVersion = "1.21.7"
        override val pluginVersion = "2.0.0"
        override fun announcement() = net.artisanmc.plugin.protocol.ServerAnnouncement(
            documentKinds = listOf(mapOf("kind" to "menu", "dir" to "menus", "schema_versions" to listOf("menu/v1"))),
        )
        override fun serverConfig() = emptyMap<String, Any?>()
        override fun customItems() = emptyList<Map<String, String>>()
        override fun applyResourcePack(hash: String, path: String) = Unit
    }

    /** Drafts as the suite database keeps them: rows by id, receipts by operation. */
    class Drafts : DraftStorage {
        val rows = java.util.concurrent.ConcurrentHashMap<String, String>()
        private val receipts = java.util.concurrent.ConcurrentHashMap<String, DraftReceipt>()
        override fun knownProject(server: String, folder: String) = true
        override fun drafts(server: String, folder: String, owner: String) = rows.values.toList()
        override fun draft(server: String, folder: String, id: String) = rows[id]
        override fun receipt(operationId: String) = receipts[operationId]
        override fun commit(server: String, folder: String, commit: DraftCommit): Boolean {
            rows[commit.draftId] = commit.body
            receipts[commit.receipt.operationId] = commit.receipt
            return true
        }
        override fun content(hash: String): ByteArray? = null
        override fun putContent(hash: String, bytes: ByteArray) = Unit
    }
}
