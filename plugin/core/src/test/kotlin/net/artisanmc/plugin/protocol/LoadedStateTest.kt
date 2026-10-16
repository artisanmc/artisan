package net.artisanmc.plugin.protocol

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LoadedStateTest {
    private val mapper = ObjectMapper()

    /** An `artisan_server_state` row as the releases before [LoadedState] wrote it (no `schema`). */
    private val v1Row = """
        {"project_ids":["quests","shop"],
         "project_roots":[{"project_id":"quests","identity":"addon","project_key":"addon:quests","module_id":"quests"},
                          {"project_id":"shop","identity":"folder","project_key":"5f0c2d4e-1b7a-4c1e-9a8b-2f3e4d5c6b7a"}],
         "resource_inventory":[{"project_id":"shop","path":"menus/main.yaml","origin":"core"}],
         "projects":{"quests":{"hash":"h-q","failed":[],"meta":{}},
                     "shop":{"hash":"h-s","failed":[{"path":"menus/bad.yaml","reason":"line 3: unknown key"}],"meta":{".artisan/editor.yaml":"zoom: 1"}}}}
    """.trimIndent()

    private fun read(json: String) = LoadedState.from(mapper.readValue(json, Map::class.java))

    @Test
    fun `a row written before the type reads whole`() {
        val state = read(v1Row)
        assertEquals(1, state.schema)
        assertEquals(listOf("quests", "shop"), state.list.projectIds)
        assertEquals(ProjectRootInfo("quests", "addon", "addon:quests", "quests"), state.list.root("quests"))
        assertEquals("5f0c2d4e-1b7a-4c1e-9a8b-2f3e4d5c6b7a", state.list.root("shop")!!.projectKey)
        assertNull(state.list.root("shop")!!.moduleId)
        assertEquals(listOf(InventoryEntry("shop", "menus/main.yaml", "core")), state.list.resourceInventory)
        assertEquals(
            LoadedProject("h-s", listOf(FailedFile("menus/bad.yaml", "line 3: unknown key")), mapOf(".artisan/editor.yaml" to "zoom: 1")),
            state.projects["shop"],
        )
    }

    @Test
    fun `written back, a row keeps every field and names its schema`() {
        val written = mapper.valueToTree<ObjectNode>(read(v1Row).toMap())
        val expected = (mapper.readTree(v1Row) as ObjectNode).put("schema", 1)
        assertEquals(expected, written)
        assertEquals(read(v1Row), read(mapper.writeValueAsString(written)))
    }

    @Test
    fun `the list part is the project_list reply, field for field`() {
        val reply = mapper.valueToTree<ObjectNode>(read(v1Row).list.toMap())
        assertEquals((mapper.readTree(v1Row) as ObjectNode).apply { remove("projects") }, reply)
    }

    @Test
    fun `missing and unknown fields are tolerated`() {
        val state = read("""{"project_ids":["x"],"project_roots":[{"project_id":"x"},{"identity":"folder"}],"projects":{"x":{"hash":"h"},"y":{}},"later":true}""")
        assertEquals(listOf(ProjectRootInfo("x")), state.list.projectRoots)
        assertEquals(emptyList(), state.list.resourceInventory)
        assertEquals(mapOf("x" to LoadedProject("h")), state.projects)
        assertNull(state.list.root("x")!!.projectKey)
    }
}
