package gg.interfaze.plugin.provider

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.model.MenuYaml
import gg.interfaze.plugin.render.MenuRenderer
import gg.interfaze.plugin.sync.BundleDownloader
import gg.interfaze.plugin.sync.BundleHasher
import gg.interfaze.plugin.ws.WsClient
import gg.interfaze.plugin.yaml.PackReader
import okhttp3.OkHttpClient
import org.bukkit.entity.Player
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
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
    private val httpClient = OkHttpClient()
    @Volatile private var wsClient: WsClient? = null
    @Volatile private var bundleDownloadInFlight = false

    override fun load() {
        reloadFromDisk()
        if (serverKey.isNotEmpty()) {
            val currentHash = BundleHasher.hashAll(packsDir)
            val client = WsClient(
                url               = wsUrl,
                serverKey         = serverKey,
                currentBundleHash = currentHash,
                onMessage         = ::handleMessage,
                logger            = logger,
            )
            wsClient = client
            client.connect()
        }
    }

    override fun unload() {
        wsClient?.disconnect()
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.dispatcher.executorService.awaitTermination(5, TimeUnit.SECONDS)
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

            "bundle_available" -> {
                if (bundleDownloadInFlight) return
                bundleDownloadInFlight = true
                try {
                    val packId = node["pack_id"]?.asText() ?: return
                    val url    = node["url"]?.asText()     ?: return
                    val downloader = BundleDownloader(httpClient, packsDir, logger)
                    downloader.download(url = url, serverKey = serverKey, packId = packId)
                    reloadFromDisk()
                    draftMenus.clear()
                } finally {
                    bundleDownloadInFlight = false
                }
            }

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
