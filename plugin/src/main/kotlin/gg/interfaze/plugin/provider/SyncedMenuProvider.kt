package gg.interfaze.plugin.provider

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.MenuYaml
import gg.interfaze.plugin.render.MenuRenderer
import gg.interfaze.plugin.ws.WsClient
import gg.interfaze.plugin.yaml.PackReader
import org.bukkit.entity.Player
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

class SyncedMenuProvider(
    private val packsDir: File,
    private val serverKey: String,
    private val wsUrl: String,
    private val logger: Logger?,
) : MenuProvider {
    @Volatile private var menus = ConcurrentHashMap<String, BundleMenu>()
    private val draftMenus = ConcurrentHashMap<String, BundleMenu>()
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    @Volatile private var wsClient: WsClient? = null

    override fun load() {
        reloadFromDisk()
        if (serverKey.isNotEmpty()) {
            val client = WsClient(
                url               = wsUrl,
                serverKey         = serverKey,
                currentBundleHash = "",   // replaced with real hash in Task 2
                onMessage         = ::handleMessage,
                logger            = logger,
            )
            wsClient = client
            client.connect()
        }
    }

    override fun unload() {
        wsClient?.disconnect()
    }

    override fun findMenu(menuId: String): BundleMenu? = draftMenus[menuId] ?: menus[menuId]

    override fun openMenu(player: Player, menuId: String, lang: String) {
        val menu = findMenu(menuId) ?: run {
            player.sendMessage("Menu '$menuId' not found.")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }

    private fun reloadFromDisk() {
        val fresh = ConcurrentHashMap<String, BundleMenu>()
        PackReader(packsDir).readAll().forEach { bundle ->
            bundle.menus.forEach { menu -> fresh[menu.id] = menu }
        }
        menus = fresh
    }

    private fun handleMessage(raw: String) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        when (node["type"]?.asText()) {
            "hello_ack" ->
                logger?.info("Connected to Interfaze backend (session=${node["session_id"]?.asText()})")

            "bundle_available" ->
                logger?.info("bundle_available received for pack ${node["pack_id"]?.asText()} — download not yet implemented")

            "draft_update" -> {
                val menuId   = node["menu_id"]?.asText()   ?: return
                val menuYaml = node["menu_yaml"]?.asText() ?: return
                val parsed   = runCatching { yamlMapper.readValue(menuYaml, MenuYaml::class.java) }.getOrNull() ?: return
                draftMenus[menuId] = BundleMenu(parsed, emptyMap())
                logger?.info("Draft updated for $menuId")
            }

            "ping" -> wsClient?.send(mapOf("type" to "pong"))
        }
    }
}
