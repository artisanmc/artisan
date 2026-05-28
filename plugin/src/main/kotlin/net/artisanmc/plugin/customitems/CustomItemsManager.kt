package net.artisanmc.plugin.customitems

import com.fasterxml.jackson.databind.ObjectMapper
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.zip.GZIPOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class CustomItemsManager(private val sources: List<CustomItemSource>) {

    private val jsonMapper = ObjectMapper()

    fun availableSources(): List<String> = sources.filter { it.isAvailable() }.map { it.namespace }

    /**
     * Stable SHA-256 of the sorted (id|label) list across all available sources.
     * Texture/model content is intentionally NOT hashed — bundles no longer carry it.
     * Returns "" when no sources produce any items.
     */
    fun computeHash(): String {
        val entries = collect()
        if (entries.isEmpty()) return ""
        val digest = MessageDigest.getInstance("SHA-256")
        for (e in entries.sortedBy { it.id }) {
            digest.update(e.id.toByteArray(Charsets.UTF_8))
            digest.update(0)
            digest.update(e.label.toByteArray(Charsets.UTF_8))
            digest.update(0)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /**
     * Returns (hash, base64(gzip(zip))) where the zip contains a single `items.json`
     * entry. Returns null when no items are available.
     */
    fun buildBundle(): Pair<String, String>? {
        val entries = collect()
        if (entries.isEmpty()) return null

        val items = entries.sortedBy { it.id }.map { e ->
            mapOf(
                "id"       to e.id,
                "label"    to stripColorCodes(e.label),
                "category" to e.category,
            )
        }
        val hash = computeHash()
        val data = encode(items)
        return Pair(hash, data)
    }

    internal fun stripColorCodes(s: String): String = s.replace(Regex("§[0-9a-fk-orA-FK-OR]"), "")

    private fun collect(): List<CustomItemEntry> =
        sources.filter { it.isAvailable() }.flatMap { it.collectItems() }

    private fun encode(items: List<Map<String, String>>): String {
        val zipBytes = ByteArrayOutputStream()
        ZipOutputStream(zipBytes).use { zip ->
            zip.putNextEntry(ZipEntry("items.json"))
            zip.write(jsonMapper.writeValueAsBytes(items))
            zip.closeEntry()
        }
        val gzipped = ByteArrayOutputStream()
        GZIPOutputStream(gzipped).use { gz -> gz.write(zipBytes.toByteArray()) }
        return Base64.getEncoder().encodeToString(gzipped.toByteArray())
    }
}
