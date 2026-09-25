package net.artisanmc.plugin

import net.artisanmc.plugin.resourcepack.AssetCatalog
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class AssetCatalogTest {

    private fun makeZip(entries: Map<String, ByteArray>): ByteArray {
        val baos = ByteArrayOutputStream()
        ZipOutputStream(baos).use { zip ->
            for ((name, content) in entries) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(content)
                zip.closeEntry()
            }
        }
        return baos.toByteArray()
    }

    private val INDEX_JSON = """
        {
          "version": 1,
          "assets": {
            "asset_cache1": { "name": "coin", "type": "glyph", "codepoint": 57344, "ascent": 8, "height": 9 }
          }
        }
    """.trimIndent()

    @Test
    fun `update persists the index to the cache file`(@org.junit.jupiter.api.io.TempDir tmp: java.nio.file.Path) {
        MockWebServer().use { server ->
            server.start()
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to INDEX_JSON.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))
            val cache = tmp.resolve("asset-index.json").toFile()
            val catalog = AssetCatalog(cacheFile = cache)
            catalog.update(server.url("/project.zip").toString(), "hash")
            assertEquals(1, catalog.size())
            kotlin.test.assertTrue(cache.exists())
            kotlin.test.assertTrue(cache.readText().contains("asset_cache1"))
        }
    }

    @Test
    fun `loadFromDisk restores the catalog without any network`(@org.junit.jupiter.api.io.TempDir tmp: java.nio.file.Path) {
        val cache = tmp.resolve("asset-index.json").toFile()
        cache.writeText(INDEX_JSON)
        val catalog = AssetCatalog(cacheFile = cache)
        catalog.loadFromDisk()
        assertEquals(1, catalog.size())
        assertNotNull(catalog.lookup("asset_cache1"))
    }

    @Test
    fun `transparent chests follow the pack's vanilla_gui flag`(@org.junit.jupiter.api.io.TempDir tmp: java.nio.file.Path) {
        val cache = tmp.resolve("asset-index.json").toFile()
        val catalog = AssetCatalog(cacheFile = cache)
        kotlin.test.assertFalse(catalog.transparentChests)
        cache.writeText("""{ "version": 2, "assets": {}, "vanilla_gui": { "transparent_chests": true } }""")
        catalog.loadFromDisk()
        kotlin.test.assertTrue(catalog.transparentChests)
        cache.writeText(INDEX_JSON)
        catalog.loadFromDisk()
        kotlin.test.assertFalse(catalog.transparentChests)
    }

    @Test
    fun `loadFromDisk with no cache file leaves the catalog empty`(@org.junit.jupiter.api.io.TempDir tmp: java.nio.file.Path) {
        val catalog = AssetCatalog(cacheFile = tmp.resolve("missing.json").toFile())
        catalog.loadFromDisk()
        assertEquals(0, catalog.size())
    }

    @Test
    fun `initial state is empty`() {
        val catalog = AssetCatalog()
        assertNull(catalog.lookup("anything"))
        assertEquals(0, catalog.size())
    }

    @Test
    fun `update fetches and parses asset-index json`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """
                {
                  "version": 1,
                  "assets": {
                    "asset_a1b2c3": {
                      "name": "coin",
                      "type": "glyph",
                      "codepoint": 57344,
                      "ascent": 8,
                      "height": 9
                    }
                  }
                }
            """.trimIndent()
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            val entry = catalog.lookup("asset_a1b2c3")
            assertNotNull(entry)
            assertEquals("coin", entry.name)
            assertEquals("glyph", entry.type)
            assertEquals(57344, entry.codepoint)
            assertEquals(8, entry.ascent)
            assertEquals(9, entry.height)
            assertEquals(57344.toChar(), entry.codepointChar)
        }
    }

    @Test
    fun `update with multiple entries parses all`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """
                {
                  "version": 1,
                  "assets": {
                    "asset_aaa": { "name": "a", "type": "glyph", "codepoint": 57344, "ascent": 8, "height": 9 },
                    "asset_bbb": { "name": "b", "type": "texture" }
                  }
                }
            """.trimIndent()
            val zipBytes = makeZip(mapOf(
                "pack.mcmeta" to "{}".toByteArray(),
                "assets/artisan/asset-index.json" to indexJson.toByteArray(),
            ))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            assertEquals(2, catalog.size())
            assertNotNull(catalog.lookup("asset_aaa"))
            val b = catalog.lookup("asset_bbb")
            assertNotNull(b)
            assertEquals("texture", b.type)
            assertNull(b.codepoint)
            assertNull(b.codepointChar)
            assertEquals(0, b.ascent)
            assertEquals(0, b.height)
        }
    }

    @Test
    fun `http failure leaves state unchanged`() {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse().setResponseCode(500))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            assertNull(catalog.lookup("asset_a1b2c3"))
            assertEquals(0, catalog.size())
        }
    }

    @Test
    fun `zip without asset-index leaves state unchanged`() {
        MockWebServer().use { server ->
            server.start()
            val zipBytes = makeZip(mapOf("pack.mcmeta" to "{}".toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            assertEquals(0, catalog.size())
        }
    }

    @Test
    fun `font entry exposes namespace`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """
                {
                  "version": 1,
                  "assets": {
                    "asset_x": {
                      "name": "my_font",
                      "type": "font",
                      "namespace": "artisan:my_font",
                      "ascent": 0,
                      "height": 0
                    }
                  }
                }
            """.trimIndent()
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            val entry = catalog.lookup("asset_x")
            assertNotNull(entry)
            assertEquals("font", entry.type)
            assertEquals("artisan:my_font", entry.namespace)
        }
    }

    @Test
    fun `glyph entry has null namespace`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """
                {
                  "version": 1,
                  "assets": {
                    "asset_g": {
                      "name": "coin",
                      "type": "glyph",
                      "codepoint": 57344,
                      "ascent": 8,
                      "height": 9
                    }
                  }
                }
            """.trimIndent()
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            val entry = catalog.lookup("asset_g")
            assertNotNull(entry)
            assertNull(entry.namespace)
        }
    }

    @Test
    fun `update parses offsets and exposes a working OffsetEncoder`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """
                {
                  "version": 2,
                  "assets": {},
                  "offsets": {
                    "F800": 1,
                    "F801": 2,
                    "F802": 4,
                    "F809": -1,
                    "F80A": -2,
                    "F80B": -4
                  }
                }
            """.trimIndent()
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            val enc = catalog.offsetEncoder()
            // 7 = 4 + 2 + 1
            val out = enc.encode(7)
            assertEquals(3, out.length)
            val byCp = mapOf(0xF800 to 1, 0xF801 to 2, 0xF802 to 4, 0xF809 to -1, 0xF80A to -2, 0xF80B to -4)
            val sum = out.sumOf { byCp[it.code] ?: 0 }
            assertEquals(7, sum)
        }
    }

    @Test
    fun `update with no offsets field leaves encoder as EMPTY`() {
        MockWebServer().use { server ->
            server.start()
            // version 1 — no offsets
            val indexJson = """{"version":1,"assets":{}}"""
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            // EMPTY encoder returns "" for any offset.
            assertEquals("", catalog.offsetEncoder().encode(7))
        }
    }

    @Test
    fun `width field is parsed when present`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """
                {
                  "version": 2,
                  "assets": {
                    "asset_bg": {
                      "name": "bg",
                      "type": "texture",
                      "height": 64,
                      "width": 176
                    }
                  },
                  "offsets": {}
                }
            """.trimIndent()
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            val entry = catalog.lookup("asset_bg")
            assertNotNull(entry)
            assertEquals(176, entry.width)
        }
    }

    @Test
    fun `width defaults to 0 when absent (legacy v1 project)`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """
                {
                  "version": 1,
                  "assets": {
                    "asset_bg": { "name": "bg", "type": "texture" }
                  }
                }
            """.trimIndent()
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "deadbeef")

            val entry = catalog.lookup("asset_bg")
            assertNotNull(entry)
            assertEquals(0, entry.width)
        }
    }

    @Test
    fun `initial offsetEncoder is EMPTY (returns empty for any input)`() {
        val catalog = AssetCatalog()
        assertEquals("", catalog.offsetEncoder().encode(5))
        assertEquals("", catalog.offsetEncoder().encode(-100))
    }

    @Test
    fun `update preserves previous state on later failure`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """{"version":1,"assets":{"asset_x":{"name":"x","type":"glyph","codepoint":57344,"ascent":8,"height":9}}}"""
            val zipBytes = makeZip(mapOf("assets/artisan/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))
            server.enqueue(MockResponse().setResponseCode(500))

            val catalog = AssetCatalog()
            catalog.update(server.url("/project.zip").toString(), "hash1")
            assertNotNull(catalog.lookup("asset_x"))

            catalog.update(server.url("/project.zip").toString(), "hash2")
            // Previous state preserved despite 500.
            assertNotNull(catalog.lookup("asset_x"))
        }
    }
}
