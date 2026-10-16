package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import kotlin.test.Test
import kotlin.test.assertEquals

class ServerAnnouncementTest {
    private val mapper = ObjectMapper()

    /** A leaf's `hello` as sent before the type existed (field names are the wire contract, ws-protocol.md). */
    private val hello = """
        {"type":"hello","protocol_version":"1.4","server_key":"s","proxy_name":"survie","server_uuid":"u-1","database_id":"db",
         "plugin_version":"2.0.0","minecraft_version":"1.21.4",
         "installed_modules":[{"id":"quests","version":"2.0.0"}],
         "data_sources":[{"ref":"shop:items","schema_hint":"id, name"}],
         "declared_models":[{"id":"shop:item","fields":[]}],
         "editor_screens":[{"id":"boutique:catalog","table":"data/categories"}],
         "declared_actions":[{"name":"message","args":[],"primary":"text"}],
         "document_kinds":[{"kind":"quest","dir":"quests","schema_versions":["quest/v1"],"module_id":"quests"}],
         "server_config":{"language":"fr"}}
    """.trimIndent()

    private fun fields(node: ObjectNode) = node.deepCopy().retain(ServerAnnouncement.EMPTY.toMap().keys)

    @Test
    fun `a hello reads into the announcement and writes back field for field`() {
        val announced = ServerAnnouncement.from(mapper.readValue(hello, Map::class.java))
        assertEquals("quests", announced.modules.single()["id"])
        assertEquals("quest", announced.documentKinds.single()["kind"])
        assertEquals(fields(mapper.readTree(hello) as ObjectNode), mapper.valueToTree<ObjectNode>(announced.toMap()))
    }

    @Test
    fun `modules_changed replaces the fields it carries and keeps the others`() {
        val announced = ServerAnnouncement.from(mapper.readValue(hello, Map::class.java))
        val changed = announced.updatedBy(mapOf("type" to "modules_changed", "installed_modules" to emptyList<Any>(), "document_kinds" to "not a list"))
        assertEquals(emptyList(), changed.modules)
        assertEquals(announced.documentKinds, changed.documentKinds)
        assertEquals(announced.actions, changed.actions)
    }

    @Test
    fun `an older server without some fields announces them empty`() {
        val announced = ServerAnnouncement.from(mapOf("installed_modules" to listOf(ServerAnnouncement.module("menus", "1.0.0"))))
        assertEquals(ServerAnnouncement(modules = listOf(mapOf("id" to "menus", "version" to "1.0.0"))), announced)
    }
}
