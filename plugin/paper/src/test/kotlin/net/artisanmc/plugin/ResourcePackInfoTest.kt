package net.artisanmc.plugin

import net.artisanmc.plugin.resourcepack.ResourcePackInfo
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals

class ResourcePackInfoTest {
    @Test
    fun `from() rejects malformed hash length`() {
        assertFailsWith<IllegalArgumentException> {
            ResourcePackInfo.from("http://x", "tooShort")
        }
    }

    @Test
    fun `the pack id depends only on the hash`() {
        val a = ResourcePackInfo.from("http://a", "f".repeat(40))
        assertEquals(a.uuid, ResourcePackInfo.from("http://b", "http://c", "f".repeat(40)).uuid)
        assertNotEquals(a.uuid, ResourcePackInfo.from("http://a", "e".repeat(40)).uuid)
    }

    @Test
    fun `single-URL from() defaults downloadUrl to url`() {
        val info = ResourcePackInfo.from("http://x.zip", "f".repeat(40))
        assertEquals("http://x.zip", info.url)
        assertEquals("http://x.zip", info.downloadUrl)
    }

    @Test
    fun `dual-URL from() stores both player and download URLs`() {
        val info = ResourcePackInfo.from(
            url = "http://localhost:3001/pack.zip",
            downloadUrl = "http://backend:3001/pack.zip",
            hash = "f".repeat(40),
        )
        assertEquals("http://localhost:3001/pack.zip", info.url)
        assertEquals("http://backend:3001/pack.zip", info.downloadUrl)
    }
}
