package net.artisanmc.plugin.hub

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.plugin.protocol.ProtocolVersion
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

/** Le serveur ne répond pas : il s'est déconnecté, ou n'est jamais venu depuis le démarrage du hub. */
class ServerOfflineException(server: String) : RuntimeException("server $server is offline")

/**
 * Un serveur du réseau relié par `/ws/plugin`. Il parle au hub comme il parlait au backend :
 * ce qu'il annonce au `hello` (modules, sources, configuration) est gardé ici, et chaque
 * requête de l'éditeur part sur son WebSocket avec un `request_id`.
 */
class RemoteServer(
    override val id: String,
    /** Adresse publique du hub : les packs qu'il sert y sont téléchargés. */
    private val publicUrl: () -> String,
    private val timeout: Duration = Duration.ofSeconds(30),
) : EditorServer {
    @Volatile private var session: Session? = null
    @Volatile private var hello: ObjectNode = Call.mapper.createObjectNode()
    @Volatile private var serverConfig: Map<String, Any?>? = null
    @Volatile private var customItems: List<Map<String, String>> = emptyList()
    @Volatile var pack: Map<String, String>? = null
        private set
    private val pending = ConcurrentHashMap<String, CompletableFuture<Map<String, Any?>>>()

    override val link = ServerLink(::request)
    override val label: String get() = id
    override val online: Boolean get() = session?.isOpen == true
    override val minecraftVersion: String get() = hello.path("minecraft_version").asText("")
    override val pluginVersion: String get() = hello.path("plugin_version").asText("")
    override val updateRequired: Boolean get() = !ProtocolVersion.compatible(hello.path("protocol_version").asText("1"))

    override fun modules() = list("installed_modules")
    override fun dataSources() = list("data_sources")
    override fun models() = list("declared_models")
    override fun screens() = list("editor_screens")
    override fun serverConfig() = serverConfig
    override fun customItems() = customItems

    override fun applyResourcePack(hash: String, path: String) {
        val update = mapOf("url" to publicUrl() + path, "hash" to hash)
        pack = update
        send(mapOf("type" to "resource_pack_updated") + update)
    }

    /** Une nouvelle connexion remplace l'ancienne : un serveur qui redémarre se recolle tout seul. */
    fun attach(session: Session, hello: ObjectNode) {
        val previous = this.session
        this.hello = hello
        serverConfig = map(hello["server_config"])
        this.session = session
        if (previous != null && previous !== session) {
            send(previous, mapOf("type" to "session_replaced", "reason" to "another server connected with this name"))
            previous.close()
        }
        requestCustomItems(hello.path("custom_items_hash").asText(""))
    }

    fun detach(session: Session) {
        if (this.session !== session) return
        this.session = null
        val offline = ServerOfflineException(id)
        pending.values.forEach { it.completeExceptionally(offline) }
    }

    /** Ce que le serveur envoie après le `hello` : réponses, puis annonces. */
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
            "modules_changed" -> hello = hello.deepCopy().apply {
                for (field in listOf("installed_modules", "data_sources", "declared_models", "editor_screens")) {
                    message[field]?.let { set<JsonNode>(field, it) }
                }
            }
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
        if (!send(message + ("request_id" to requestId))) reply.completeExceptionally(ServerOfflineException(id))
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

    private fun list(field: String): List<Map<String, Any?>> =
        hello[field]?.takeIf { it.isArray }?.let { Call.mapper.convertValue(it, LIST) }.orEmpty()

    private fun map(node: JsonNode?): Map<String, Any?>? =
        node?.takeIf { it.isObject }?.let { Call.mapper.convertValue(it, MAP) }

    /** Le format de `CustomItemsManager.buildBundle` : `items.json` dans un zip, gzippé, en base64. */
    private fun decodeCustomItems(data: String): List<Map<String, String>> = runCatching {
        ZipInputStream(GZIPInputStream(ByteArrayInputStream(Base64.getDecoder().decode(data)))).use { zip ->
            generateSequence { zip.nextEntry }.firstOrNull { it.name == "items.json" } ?: return@use customItems
            Call.mapper.readValue(zip.readBytes(), ITEMS)
        }
    }.getOrDefault(customItems)

    private companion object {
        val MAP = object : TypeReference<Map<String, Any?>>() {}
        val LIST = object : TypeReference<List<Map<String, Any?>>>() {}
        val ITEMS = object : TypeReference<List<Map<String, String>>>() {}
    }
}
