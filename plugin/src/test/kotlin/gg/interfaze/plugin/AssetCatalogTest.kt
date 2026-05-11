package gg.interfaze.plugin

import gg.interfaze.plugin.resourcepack.AssetCatalog
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
            val zipBytes = makeZip(mapOf("assets/interfaze/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/pack.zip").toString(), "deadbeef")

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
                "assets/interfaze/asset-index.json" to indexJson.toByteArray(),
            ))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))

            val catalog = AssetCatalog()
            catalog.update(server.url("/pack.zip").toString(), "deadbeef")

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
            catalog.update(server.url("/pack.zip").toString(), "deadbeef")

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
            catalog.update(server.url("/pack.zip").toString(), "deadbeef")

            assertEquals(0, catalog.size())
        }
    }

    @Test
    fun `update preserves previous state on later failure`() {
        MockWebServer().use { server ->
            server.start()
            val indexJson = """{"version":1,"assets":{"asset_x":{"name":"x","type":"glyph","codepoint":57344,"ascent":8,"height":9}}}"""
            val zipBytes = makeZip(mapOf("assets/interfaze/asset-index.json" to indexJson.toByteArray()))
            server.enqueue(MockResponse().setBody(Buffer().apply { write(zipBytes) }))
            server.enqueue(MockResponse().setResponseCode(500))

            val catalog = AssetCatalog()
            catalog.update(server.url("/pack.zip").toString(), "hash1")
            assertNotNull(catalog.lookup("asset_x"))

            catalog.update(server.url("/pack.zip").toString(), "hash2")
            // Previous state preserved despite 500.
            assertNotNull(catalog.lookup("asset_x"))
        }
    }
}
