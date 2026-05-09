package gg.interfaze.plugin.customitems

import org.bukkit.Bukkit
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.logging.Logger
import java.util.zip.ZipFile

private val log = Logger.getLogger("Interfaze")

class NexoSource(private val pluginsDir: File) : CustomItemSource {
    override val namespace = "nexo"

    @Volatile private var cachedZips: List<File> = emptyList()
    private val zipDiagDone = AtomicBoolean(false)

    override fun isAvailable(): Boolean =
        runCatching { Bukkit.getPluginManager().getPlugin("Nexo") != null }.getOrDefault(false)

    override fun collectItems(): List<CustomItemEntry> {
        if (!isAvailable()) return emptyList()
        val nexoDir = File(pluginsDir, "Nexo")
        // Refresh zip list once per sync cycle, skip vanilla asset cache
        cachedZips = nexoDir.walkTopDown()
            .filter { it.isFile && it.extension == "zip" && !it.path.contains(".assetCache") }
            .toList()
        if (zipDiagDone.compareAndSet(false, true)) {
            log.info("[IFZ] NexoSource: searching ${cachedZips.size} zip(s): ${cachedZips.map { it.relativeTo(nexoDir).path }}")
        }
        return try {
            val nexoItems = Class.forName("com.nexomc.nexo.api.NexoItems")
            @Suppress("UNCHECKED_CAST")
            val names = nexoItems.getMethod("itemNames").invoke(null) as Collection<String>
            log.info("[IFZ] NexoSource: ${names.size} item name(s) from NexoItems.itemNames()")
            names.mapNotNull { id ->
                val itemObj = nexoItems.getMethod("itemFromId", String::class.java).invoke(null, id)
                    ?: return@mapNotNull null
                val displayName = try {
                    val stack = itemObj.javaClass.getMethod("itemStack").invoke(itemObj)
                    val meta = (stack as org.bukkit.inventory.ItemStack).itemMeta
                    meta?.displayName()?.let {
                        net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer.plainText().serialize(it)
                    } ?: id
                } catch (_: Exception) { id }
                CustomItemEntry(
                    id = "nexo:$id",
                    label = displayName,
                    texturePath = "nexo/$id",
                    modelJson = loadModelJson(id),
                )
            }
        } catch (e: Exception) {
            log.warning("[IFZ] NexoSource.collectItems() failed: ${e.javaClass.name}: ${e.message}")
            emptyList()
        }
    }

    override fun loadTexture(texturePath: String): ByteArray? {
        val id = texturePath.removePrefix("nexo/")
        val filename = "${id.substringAfterLast("/")}.png"
        val packDir = File(File(pluginsDir, "Nexo"), "pack")

        // 1. Individual PNG files under plugins/Nexo/pack/
        if (packDir.exists()) {
            packDir.walkTopDown()
                .firstOrNull { it.isFile && it.name == filename }
                ?.let { return it.readBytes() }
        }

        // 2. Search cached zip list (built once per sync cycle in collectItems())
        for (zip in cachedZips) {
            loadFromZip(zip) { it.name.endsWith(filename) }?.let { return it }
            loadViaModel(zip, id)?.let { return it }
        }

        return null
    }

    private fun loadFromZip(zipFile: File, predicate: (java.util.zip.ZipEntry) -> Boolean): ByteArray? =
        runCatching {
            ZipFile(zipFile).use { zip ->
                zip.entries().asSequence()
                    .firstOrNull { !it.isDirectory && predicate(it) }
                    ?.let { zip.getInputStream(it).readBytes() }
            }
        }.getOrNull()

    /**
     * Resolves a texture via the item's model JSON.
     * Finds `models/item/{id}.json` in zip, extracts the `layer0` texture reference,
     * then loads the PNG from the same zip.
     */
    private fun loadViaModel(zipFile: File, itemId: String): ByteArray? =
        runCatching {
            ZipFile(zipFile).use { zip ->
                val modelEntry = zip.entries().asSequence()
                    .firstOrNull { !it.isDirectory && it.name.endsWith("models/item/$itemId.json") }
                    ?: return null

                val modelJson = String(zip.getInputStream(modelEntry).readBytes())
                val textureRef = Regex(""""layer\d"\s*:\s*"([^"]+)"""").find(modelJson)
                    ?.groupValues?.get(1) ?: return null

                // "nexo:item/forest_helmet" → "assets/nexo/textures/item/forest_helmet.png"
                val entryPath = if (":" in textureRef) {
                    val (ns, path) = textureRef.split(":", limit = 2)
                    "assets/$ns/textures/$path.png"
                } else {
                    "assets/minecraft/textures/$textureRef.png"
                }

                zip.entries().asSequence()
                    .firstOrNull { !it.isDirectory && it.name.endsWith(entryPath) }
                    ?.let { zip.getInputStream(it).readBytes() }
            }
        }.getOrNull()

    private fun loadModelJson(itemId: String): String? {
        for (zip in cachedZips) {
            runCatching {
                ZipFile(zip).use { z ->
                    z.entries().asSequence()
                        .firstOrNull { !it.isDirectory && it.name.endsWith("models/item/$itemId.json") }
                        ?.let { String(z.getInputStream(it).readBytes()) }
                }
            }.getOrNull()?.let { return it }
        }
        return null
    }
}
