package net.artisanmc.plugin.hub

import net.artisanmc.plugin.protocol.ServerLink
import java.util.concurrent.CompletableFuture

/** A hub's world for the MCP and assistant tests: one server with a shop Project, drafts in memory. */
object McpFixtures {
    /**
     * Server `u-local`: [sent] records each message; a file saying `bad` fails its check. A
     * publication is written and loaded at once: [history] gets its Version.
     */
    fun server(sent: MutableList<Map<String, Any?>>, history: History? = null): EditorServer = object : EditorServer {
        override val id = "u-local"
        override val online = true
        override val link = ServerLink { message ->
            sent += message
            val reply = when (message["type"]) {
                "project_list" -> mapOf("ok" to true, "project_ids" to listOf("shop"))
                "project_create" -> if (message["project_id"] == "shop") mapOf("ok" to false, "error" to "project_exists") else mapOf("ok" to true)
                "project_read" -> mapOf(
                    "ok" to true, "hash" to "h1",
                    "files" to (history?.versions?.last()?.files ?: mapOf("menus/shop.yml" to "schema: menu/v1\n", "lang/en.yml" to "a: b\n"))
                        .map { (path, content) -> mapOf("path" to path, "content" to content) },
                    "failed" to emptyList<Any>(), "binaries" to emptyList<Any>(),
                )
                // The server's check: a file saying `bad` does not load.
                "documents_check" -> {
                    @Suppress("UNCHECKED_CAST")
                    val files = message["files"] as List<Map<String, String>>
                    mapOf("ok" to true, "problems" to files.filter { "bad" in it.getValue("content") }
                        .map { mapOf("path" to it["path"], "stage" to "schema", "message" to "\$.bad: is not defined in the schema") })
                }
                "project_draft_publish" -> {
                    // The draft as the hub stores it, a JSON node: read like the server reads the message.
                    @Suppress("UNCHECKED_CAST")
                    val draft = Call.mapper.convertValue(message["draft"], Map::class.java) as Map<String, Any?>
                    @Suppress("UNCHECKED_CAST")
                    val snapshot = draft["snapshot"] as Map<String, Any?>
                    @Suppress("UNCHECKED_CAST")
                    val tree = snapshot["tree"] as Map<String, String>
                    history?.record(
                        tree, mapOf("id" to message["author_id"], "name" to message["author_name"], "via" to message["author_via"]),
                        snapshot["restoredFrom"] as String?,
                    )
                    mapOf("ok" to true, "wrote" to tree.size)
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
            actions = listOf(
                mapOf("name" to "open_menu", "args" to emptyList<Any>()),
                mapOf(
                    "name" to "guilds:rank_delete", "module_id" to "guilds", "primary" to "rank",
                    "args" to listOf(mapOf("name" to "rank", "type" to mapOf("kind" to "string"), "required" to true, "help" to "The rank to delete.")),
                ),
            ),
        )
        override fun serverConfig() = emptyMap<String, Any?>()
        override fun customItems() = emptyList<Map<String, String>>()
        override fun applyResourcePack(hash: String, path: String) = Unit
    }

    /** Versions as the suite database keeps them: Version 1 is the shop as the server runs it. */
    class History : ProjectHistory {
        class Recorded(val id: Int, val files: Map<String, String>, val author: Map<String, Any?>?, val restoredFrom: String?)
        val versions = java.util.concurrent.CopyOnWriteArrayList(
            listOf(Recorded(1, mapOf("menus/shop.yml" to "schema: menu/v1\n", "lang/en.yml" to "a: b\n"), null, null)),
        )

        fun record(files: Map<String, String>, author: Map<String, Any?>, restoredFrom: String?) {
            versions += Recorded(versions.size + 1, files, author, restoredFrom)
        }

        override fun versions(server: String, folder: String) = versions.reversed().map {
            mapOf("id" to it.id.toString(), "createdAt" to "2026-10-29T12:00:00Z", "author" to it.author, "changed" to it.files.keys.toList(), "restoredFrom" to it.restoredFrom)
        }
        override fun version(server: String, folder: String, id: String) = versions.firstOrNull { it.id.toString() == id }?.let { v ->
            mapOf("id" to id, "files" to v.files.map { (path, content) -> mapOf("path" to path, "content" to content) }, "binaries" to emptyList<Any>())
        }
        override fun versionBinary(server: String, folder: String, id: String, path: String): ByteArray? = null
        override fun fileHistory(server: String, folder: String, path: String) = emptyList<Map<String, Any?>>()
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
