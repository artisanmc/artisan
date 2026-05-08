package gg.interfaze.plugin.customitems

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class CustomItemsManager(private val sources: List<CustomItemSource>) {

    private val jsonMapper = ObjectMapper()

    fun computeHash(): String {
        val pairs = collectWithTextures()
        if (pairs.isEmpty()) return ""
        val digest = MessageDigest.getInstance("SHA-256")
        for ((id, bytes) in pairs.sortedBy { it.first }) {
            digest.update(id.toByteArray(Charsets.UTF_8))
            digest.update(bytes)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun buildBundle(): Pair<String, String>? {
        val items = mutableListOf<Map<String, String>>()
        val textures = mutableMapOf<String, ByteArray>()

        for (source in sources.filter { it.isAvailable() }) {
            for (entry in source.collectItems()) {
                val bytes = source.loadTexture(entry.texturePath) ?: continue
                items += mapOf(
                    "id"       to entry.id,
                    "label"    to stripColorCodes(entry.label),
                    "category" to entry.category(),
                    "texture"  to entry.texturePath,
                )
                textures[entry.texturePath] = bytes
            }
        }
        if (items.isEmpty()) return null

        val digest = MessageDigest.getInstance("SHA-256")
        for (item in items.sortedBy { it["id"]!! }) {
            val texturePath = item["texture"]!!
            val bytes = textures[texturePath] ?: continue
            digest.update(item["id"]!!.toByteArray(Charsets.UTF_8))
            digest.update(bytes)
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }

        val data = buildData(items, textures)
        return Pair(hash, data)
    }

    fun stripColorCodes(s: String): String = s.replace(Regex("§[0-9a-fk-orA-FK-OR]"), "")

    private fun collectWithTextures(): List<Pair<String, ByteArray>> =
        sources.filter { it.isAvailable() }
            .flatMap { source ->
                source.collectItems().mapNotNull { entry ->
                    val bytes = source.loadTexture(entry.texturePath) ?: return@mapNotNull null
                    Pair(entry.id, bytes)
                }
            }

    private fun buildData(items: List<Map<String, String>>, textures: Map<String, ByteArray>): String {
        val zipBytes = ByteArrayOutputStream()
        ZipOutputStream(zipBytes).use { zip ->
            zip.putNextEntry(ZipEntry("items.json"))
            zip.write(jsonMapper.writeValueAsBytes(items))
            zip.closeEntry()
            for ((path, bytes) in textures) {
                zip.putNextEntry(ZipEntry("textures/$path.png"))
                zip.write(bytes)
                zip.closeEntry()
            }
        }
        val gzipped = ByteArrayOutputStream()
        GZIPOutputStream(gzipped).use { gz -> gz.write(zipBytes.toByteArray()) }
        return Base64.getEncoder().encodeToString(gzipped.toByteArray())
    }
}
