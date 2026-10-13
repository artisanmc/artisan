package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.ObjectMapper
import kotlin.test.Test
import kotlin.test.assertEquals
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
        val ack = parse("""{"type":"hello_ack","resource_pack":{"url":"u","hash":"h"}}""") as EditorRequest.HelloAck
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
    fun `messages only the cloud backend sent are ignored`() {
        for (type in listOf("ping", "draft_update", "project_deleted", "project_copy", "asset_write", "import_sources_list")) {
            assertNull(parse("""{"type":"$type","request_id":"r","project_id":"p","menu_id":"m","menu_yaml":"x"}"""), type)
        }
    }
}
