package gg.interfaze.plugin.provider

import gg.interfaze.plugin.model.BundleMenu
import org.bukkit.entity.Player

interface MenuProvider {
    fun load()
    fun unload() {}
    fun findMenu(menuId: String): BundleMenu?
    fun openMenu(player: Player, menuId: String, lang: String)
}
