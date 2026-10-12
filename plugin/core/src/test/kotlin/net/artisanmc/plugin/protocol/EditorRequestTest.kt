package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class EditorRequestTest {
    private val mapper = ObjectMapper()
    private fun parse(json: String) = EditorRequest.parse(mapper.readTree(json))

    @Test
    fun `unknown types and missing required fields are ignored`() {
        assertNull(parse("""{"type":"nope","request_id":"r"}"""))
        assertNull(parse("""{"type":"project_read","request_id":"r"}"""))
        assertNull(parse("""{"type":"project_list"}"""))
    }

    @Test
    fun `hello_ack distinguishes a cleared pack from an incomplete one`() {
        assertEquals(EditorRequest.PackUpdate.Cleared, (parse("""{"type":"hello_ack"}""") as EditorRequest.HelloAck).resourcePack)
        assertEquals(
            EditorRequest.PackUpdate.Incomplete,
            (parse("""{"type":"hello_ack","resource_pack":{"url":"u"}}""") as EditorRequest.HelloAck).resourcePack,
        )
        val ack = parse("""{"type":"hello_ack","api_url":"a","editor_url":"e","resource_pack":{"url":"u","hash":"h"}}""") as EditorRequest.HelloAck
        assertEquals("a", ack.bundleUrl)
        assertEquals("e", ack.editorUrl)
        assertEquals(EditorRequest.PackUpdate.Apply("u", "h"), ack.resourcePack)
    }

    @Test
    fun `malformed binaries make the whole write invalid`() {
        fun binaries(json: String) = (parse("""{"type":"project_write","request_id":"r","project_id":"p","binaries":$json}""") as EditorRequest.ProjectWrite).binaries
        assertEquals(emptyList(), (parse("""{"type":"project_write","request_id":"r","project_id":"p"}""") as EditorRequest.ProjectWrite).binaries)
        assertNull(binaries("null"))
        assertNull(binaries("""[{"path":"a.png"}]"""))
        assertNull(binaries("""[{"path":"a.png","content_base64":1}]"""))
        assertNull(binaries("""[{"path":"a.png","content_base64":null,"base_hash":2}]"""))
        assertEquals(
            listOf(EditorRequest.BinaryWrite("a.png", null, "h")),
            binaries("""[{"path":"a.png","content_base64":null,"base_hash":"h"}]"""),
        )
    }

    @Test
    fun `asset_write keeps the single-file form`() {
        val write = parse("""{"type":"asset_write","request_id":"r","project_id":"p","path":"a.png","content_base64":"AA=="}""")
        assertIs<EditorRequest.AssetWrite>(write)
        assertEquals(listOf(EditorRequest.BinaryWrite("a.png", "AA==", null)), write.writes)
    }

    @Test
    fun `an invalid selection rejects the whole import read`() {
        val read = parse("""{"type":"import_sources_read","request_id":"r","selections":[{"source_id":"s","paths":["a",1]}]}""")
        assertIs<EditorRequest.ImportSourcesRead>(read)
        assertNull(read.selections)
    }
}
