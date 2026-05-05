package gg.interfaze.plugin.provider

import gg.interfaze.plugin.model.BundleMenu
import gg.interfaze.plugin.render.MenuRenderer
import gg.interfaze.plugin.yaml.PackReader
import org.bukkit.entity.Player
import java.io.File

class FilesystemMenuProvider(private val packsDir: File) : MenuProvider {
    private val menus = mutableMapOf<String, BundleMenu>()

    override fun load() {
        menus.clear()
        PackReader(packsDir).readAll().forEach { bundle ->
            bundle.menus.forEach { menu -> menus[menu.id] = menu }
        }
    }

    override fun findMenu(menuId: String): BundleMenu? = menus[menuId]

    override fun openMenu(player: Player, menuId: String, lang: String) {
        val menu = menus[menuId] ?: run {
            player.sendMessage("Menu '$menuId' not found.")
            return
        }
        MenuRenderer.open(player, menu, lang)
    }
}
