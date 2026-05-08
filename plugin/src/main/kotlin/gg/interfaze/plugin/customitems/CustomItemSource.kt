package gg.interfaze.plugin.customitems

interface CustomItemSource {
    val namespace: String
    fun isAvailable(): Boolean
    fun collectItems(): List<CustomItemEntry>
    fun loadTexture(texturePath: String): ByteArray?
}

data class CustomItemEntry(
    val id: String,           // e.g. "nexo:iron_coin"
    val label: String,
    val texturePath: String,  // e.g. "nexo/iron_coin" (no .png, relative to archive textures/)
) {
    fun category(): String = id.substringBefore(":")
}
