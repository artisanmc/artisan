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

    companion object {
        // 1×1 gray PNG — used when no texture file can be found for a custom item.
        // Sourced from a known-good minimal PNG (base64-encoded).
        val PLACEHOLDER_PNG: ByteArray = java.util.Base64.getDecoder().decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVQI12NgAAAAAgAB4iG8MwAAAABJRU5ErkJggg=="
        )
    }

    fun availableSources(): List<String> = sources.filter { it.isAvailable() }.map { it.namespace }

    fun rawItemCount(): Int =
        sources.filter { it.isAvailable() }.sumOf { runCatching { it.collectItems().size }.getOrDefault(0) }

    fun computeHash(): String {
        val triples = collectWithModels()
        if (triples.isEmpty()) return ""
        val digest = MessageDigest.getInstance("SHA-256")
        for ((id, textureBytes, modelJson) in triples.sortedBy { it.first }) {
            digest.update(id.toByteArray(Charsets.UTF_8))
            digest.update(textureBytes)
            if (modelJson != null) digest.update(modelJson.toByteArray(Charsets.UTF_8))
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    fun buildBundle(): Pair<String, String>? {
        val items = mutableListOf<Map<String, String>>()
        val textures = mutableMapOf<String, ByteArray>()
        val models = mutableMapOf<String, String>()

        for (source in sources.filter { it.isAvailable() }) {
            for (entry in source.collectItems()) {
                // Use placeholder when no texture is available so the item still appears in the Library.
                val bytes = source.loadTexture(entry.texturePath) ?: PLACEHOLDER_PNG
                items += mapOf(
                    "id"       to entry.id,
                    "label"    to stripColorCodes(entry.label),
                    "category" to entry.category(),
                    "texture"  to entry.texturePath,
                )
                textures[entry.texturePath] = bytes
                entry.modelJson?.let { models[entry.texturePath] = it }
            }
        }
        if (items.isEmpty()) return null

        val digest = MessageDigest.getInstance("SHA-256")
        for (item in items.sortedBy { it["id"]!! }) {
            val texturePath = item["texture"]!!
            val texBytes = textures[texturePath] ?: continue
            digest.update(item["id"]!!.toByteArray(Charsets.UTF_8))
            digest.update(texBytes)
            models[texturePath]?.let { digest.update(it.toByteArray(Charsets.UTF_8)) }
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }

        val data = buildData(items, textures, models)
        return Pair(hash, data)
    }

    internal fun stripColorCodes(s: String): String = s.replace(Regex("§[0-9a-fk-orA-FK-OR]"), "")

    private fun collectWithModels(): List<Triple<String, ByteArray, String?>> =
        sources.filter { it.isAvailable() }
            .flatMap { source ->
                source.collectItems().map { entry ->
                    Triple(entry.id, source.loadTexture(entry.texturePath) ?: PLACEHOLDER_PNG, entry.modelJson)
                }
            }

    private fun buildData(
        items: List<Map<String, String>>,
        textures: Map<String, ByteArray>,
        models: Map<String, String>,
    ): String {
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
            for ((path, json) in models) {
                zip.putNextEntry(ZipEntry("models/$path.json"))
                zip.write(json.toByteArray(Charsets.UTF_8))
                zip.closeEntry()
            }
        }
        val gzipped = ByteArrayOutputStream()
        GZIPOutputStream(gzipped).use { gz -> gz.write(zipBytes.toByteArray()) }
        return Base64.getEncoder().encodeToString(gzipped.toByteArray())
    }
}
