package net.artisanmc.plugin

import net.artisanmc.plugin.resourcepack.ResourcePackInfo
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ResourcePackInfoTest {
    @Test
    fun `from() decodes a 40-char hex hash to 20 sha1 bytes`() {
        val info = ResourcePackInfo.from(
            "http://example/x.zip",
            "abcdef0123456789abcdef0123456789abcdef01",
            "<gold>p</gold>",
        )
        assertEquals(20, info.sha1Bytes.size)
        // first byte 0xab
        assertEquals(0xab.toByte(), info.sha1Bytes[0])
    }

    @Test
    fun `from() generates a stable UUID per hash`() {
        val a = ResourcePackInfo.from("http://x", "abcdef0123456789abcdef0123456789abcdef01", "")
        val b = ResourcePackInfo.from("http://x", "abcdef0123456789abcdef0123456789abcdef01", "")
        assertEquals(a.uuid, b.uuid)
        // Different hash → different UUID
        val c = ResourcePackInfo.from("http://x", "abcdef0123456789abcdef0123456789abcdef02", "")
        assertEquals(UUID.nameUUIDFromBytes("abcdef0123456789abcdef0123456789abcdef02".toByteArray(Charsets.UTF_8)), c.uuid)
    }

    @Test
    fun `from() rejects malformed hash length`() {
        assertFailsWith<IllegalArgumentException> {
            ResourcePackInfo.from("http://x", "tooShort", "")
        }
    }

    @Test
    fun `single-URL from() defaults downloadUrl to url`() {
        val info = ResourcePackInfo.from("http://x.zip", "f".repeat(40), "")
        assertEquals("http://x.zip", info.url)
        assertEquals("http://x.zip", info.downloadUrl)
    }

    @Test
    fun `dual-URL from() stores both player and download URLs`() {
        val info = ResourcePackInfo.from(
            url = "http://localhost:3001/pack.zip",
            downloadUrl = "http://backend:3001/pack.zip",
            hash = "f".repeat(40),
            promptMini = "",
        )
        assertEquals("http://localhost:3001/pack.zip", info.url)
        assertEquals("http://backend:3001/pack.zip", info.downloadUrl)
    }
}
