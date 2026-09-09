package me.arcaniax.hdb.api

import org.bukkit.inventory.ItemStack

/** External API fixture for Artisan's reflection adapter. */
class HeadDatabaseAPI {
    companion object {
        val heads = mutableMapOf<String, ItemStack>()
    }
    fun getItemHead(id: String): ItemStack? = heads[id]?.clone()
}
