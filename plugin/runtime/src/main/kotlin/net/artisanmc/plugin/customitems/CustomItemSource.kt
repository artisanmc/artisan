package net.artisanmc.plugin.customitems

interface CustomItemSource {
    val namespace: String
    fun isAvailable(): Boolean
    fun collectItems(): List<CustomItemEntry>
}

data class CustomItemEntry(
    val id: String,       // e.g. "nexo:iron_coin"
    val label: String,    // human-readable or = id when no label available
    val category: String, // namespace ("nexo", "oraxen", "itemsadder")
)
