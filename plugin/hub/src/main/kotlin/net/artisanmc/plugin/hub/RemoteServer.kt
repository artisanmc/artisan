package net.artisanmc.plugin.hub

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.protocol.ProtocolVersion
import net.artisanmc.plugin.protocol.ServerAnnouncement
import net.artisanmc.plugin.protocol.ServerLink
import org.eclipse.jetty.websocket.api.Callback
import org.eclipse.jetty.websocket.api.Session
import java.io.ByteArrayInputStream
import java.time.Duration
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream

/** The server does not answer: it disconnected, or never connected since the hub started. */
class ServerOfflineException(server: String) : RuntimeException("server $server is offline")

/**
 * A network server connected through `/ws/plugin`. What it announces in `hello` (modules, sources,
 * configuration) is kept here, and each editor request goes out on its WebSocket with a `request_id`.
 */
class RemoteServer(
    /** Its server id, from the database while it is offline, from its `hello` once connected. */
    override val id: String,
    /** Its name, known from the database while it is offline; its `hello` says it once connected. */
    @Volatile var name: String = "",
    /** The hub's public address: the packs it serves are downloaded from there. */
    private val publicUrl: () -> String,
    private val timeout: Duration = Duration.ofSeconds(30),
) : EditorServer {
    @Volatile private var session: Session? = null
    @Volatile private var hello: ObjectNode = Call.mapper.createObjectNode()
    @Volatile private var announcement = ServerAnnouncement.EMPTY
    @Volatile private var serverConfig: Map<String, Any?>? = null
    @Volatile private var customItems: List<Map<String, String>> = emptyList()
    @Volatile var pack: Map<String, String>? = null
        private set
    @Volatile var bedrockPack: Map<String, String>? = null
        private set
    private val pending = ConcurrentHashMap<String, CompletableFuture<Map<String, Any?>>>()

    override val link = ServerLink(::request)
    override val label: String get() = name.ifEmpty { id }
    override val online: Boolean get() = session?.isOpen == true
    override val minecraftVersion: String get() = hello.path("minecraft_version").asText("")
    override val pluginVersion: String get() = hello.path("plugin_version").asText("")
    override val protocolVersion: String get() = hello.path("protocol_version").asText("1")
    override val updateRequired: Boolean get() = !ProtocolVersion.compatible(protocolVersion)

    override fun announcement() = announcement
    override fun serverConfig() = serverConfig
    override fun customItems() = customItems

    override fun applyResourcePack(hash: String, path: String) {
        val update = mapOf("url" to publicUrl() + path, "hash" to hash)
        pack = update
        send(mapOf("type" to "resource_pack_updated") + update)
    }

    override fun applyBedrockPack(hash: String, path: String) {
        val update = mapOf("url" to publicUrl() + path, "hash" to hash)
        bedrockPack = update
        // A leaf older than the message ignores it; the hello_ack carries it at its next connection.
        if (ProtocolVersion.minor(protocolVersion) >= ProtocolVersion.BEDROCK_PACK) send(mapOf("type" to "bedrock_pack_updated") + update)
    }

    /** A new connection replaces the old one: a restarting server reattaches by itself. */
    fun attach(session: Session, hello: ObjectNode) {
        val previous = this.session
        this.hello = hello
        announcement = ServerAnnouncement.from(Call.mapper.convertValue(hello, MAP))
        hello.path("proxy_name").asText("").takeIf { it.isNotEmpty() }?.let { name = it }
        serverConfig = map(hello["server_config"])
        this.session = session
        if (previous != null && previous !== session) {
            send(previous, mapOf("type" to "session_replaced", "reason" to "another server connected with this server id"))
            previous.close()
        }
        requestCustomItems(hello.path("custom_items_hash").asText(""))
    }

    fun detach(session: Session) {
        if (this.session !== session) return
        this.session = null
        val offline = ServerOfflineException(label)
        pending.values.forEach { it.completeExceptionally(offline) }
    }

    /** What the server sends after `hello`: replies, then announcements. */
    fun receive(message: JsonNode, editors: EditorChannel) {
        val requestId = message.path("request_id").asText("")
        if (requestId.isNotEmpty()) {
            val reply = Call.mapper.convertValue(message, MAP)
            if (message.path("type").asText() == "server_config_write_result" && message.path("ok").asBoolean()) {
                serverConfig = map(message["server_config"])
            }
            pending[requestId]?.complete(reply)
            return
        }
        when (message.path("type").asText()) {
            "modules_changed" -> announcement = announcement.updatedBy(Call.mapper.convertValue(message, MAP))
            "custom_items_changed" -> requestCustomItems(message.path("hash").asText(""))
            "custom_items_bundle" -> customItems = decodeCustomItems(message.path("data").asText(""))
            "projects_reloaded" -> editors.relay(Call.mapper.convertValue(message, MAP), id)
        }
    }

    private fun request(message: Map<String, Any?>): CompletableFuture<Map<String, Any?>> {
        val requestId = "hub-${UUID.randomUUID()}"
        val reply = CompletableFuture<Map<String, Any?>>()
        pending[requestId] = reply
        reply.whenComplete { _, _ -> pending.remove(requestId) }
        if (!send(message + ("request_id" to requestId))) reply.completeExceptionally(ServerOfflineException(label))
        return reply.orTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS)
    }

    private fun send(message: Map<String, Any?>): Boolean {
        if (updateRequired) return false
        val current = session?.takeIf { it.isOpen } ?: return false
        send(current, message)
        return true
    }

    private fun send(session: Session, message: Map<String, Any?>) =
        session.sendText(Call.mapper.writeValueAsString(message), Callback.NOOP)

    private fun requestCustomItems(hash: String) {
        if (hash.isNotEmpty()) send(mapOf("type" to "custom_items_request"))
    }

    private fun map(node: JsonNode?): Map<String, Any?>? =
        node?.takeIf { it.isObject }?.let { Call.mapper.convertValue(it, MAP) }

    /** The `CustomItemsManager.buildBundle` format: `items.json` in a zip, gzipped, base64. */
    private fun decodeCustomItems(data: String): List<Map<String, String>> = runCatching {
        ZipInputStream(GZIPInputStream(ByteArrayInputStream(Base64.getDecoder().decode(data)))).use { zip ->
            generateSequence { zip.nextEntry }.firstOrNull { it.name == "items.json" } ?: return@use customItems
            Call.mapper.readValue(zip.readBytes(), ITEMS)
        }
    }.getOrDefault(customItems)

    private companion object {
        val MAP = object : TypeReference<Map<String, Any?>>() {}
        val ITEMS = object : TypeReference<List<Map<String, String>>>() {}
    }
}
