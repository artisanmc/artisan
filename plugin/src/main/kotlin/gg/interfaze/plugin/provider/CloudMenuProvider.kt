package gg.interfaze.plugin.provider

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.MenuYaml
import gg.interfaze.plugin.render.MenuRenderer
import gg.interfaze.plugin.ws.WsClient
import org.bukkit.entity.Player
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger

class CloudMenuProvider(
    private val wsUrl: String,
    private val serverKey: String,
    private val logger: Logger?,
) : MenuProvider {
    private val liveMenus  = ConcurrentHashMap<String, BundleMenu>()
    private val draftMenus = ConcurrentHashMap<String, BundleMenu>()
    private lateinit var wsClient: WsClient
    private val jsonMapper = ObjectMapper()
    private val yamlMapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    override fun load() {
        wsClient = WsClient(wsUrl, serverKey, onMessage = ::handleMessage, logger = logger)
        wsClient.connect()
    }

    override fun unload() {
        if (::wsClient.isInitialized) {
            wsClient.disconnect()
        }
    }

    override fun findMenu(menuId: String): BundleMenu? = liveMenus[menuId]

    override fun openMenu(player: Player, menuId: String, lang: String) {
        val menu = liveMenus[menuId] ?: run {
            player.sendMessage("Menu '$menuId' not found (cloud mode).")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }

    fun openDraft(player: Player, menuId: String, lang: String) {
        val menu = draftMenus[menuId] ?: liveMenus[menuId] ?: run {
            player.sendMessage("No draft for menu '$menuId'.")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }

    private fun handleMessage(raw: String) {
        val node = runCatching { jsonMapper.readTree(raw) }.getOrNull() ?: return
        when (node["type"]?.asText()) {
            "hello_ack" ->
                logger?.info("Connected to Interfaze backend (session=${node["session_id"]?.asText()})")

            "draft_update" -> {
                val menuId   = node["menu_id"]?.asText()   ?: return
                val menuYaml = node["menu_yaml"]?.asText() ?: return
                val parsed   = runCatching { yamlMapper.readValue(menuYaml, MenuYaml::class.java) }.getOrNull() ?: return
                draftMenus[menuId] = BundleMenu(parsed, emptyMap())
                logger?.info("Draft updated for menu $menuId")
            }
        }
    }
}
