package net.artisanmc.plugin.protocol

import java.time.Duration
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith

class LocalServerLinkTest {
    @Test
    fun `the reply carrying the request id completes the request`() {
        lateinit var link: LocalServerLink
        link = LocalServerLink({ node ->
            val id = node["request_id"].asText()
            assertEquals("project_list", node["type"].asText())
            assertFalse(link.deliver(mapOf("type" to "projects_reloaded")))
            assertTrue(link.deliver(mapOf("type" to "project_list_result", "request_id" to id, "ok" to true)))
        })
        val reply = link.request(mapOf("type" to "project_list")).get()
        assertEquals(true, reply["ok"])
        assertFalse(link.deliver(reply), "a request is answered once")
    }

    @Test
    fun `no reply times out`() {
        val link = LocalServerLink({}, Duration.ofMillis(50))
        val error = assertFailsWith<ExecutionException> { link.request(mapOf("type" to "project_list")).get() }
        assertIs<TimeoutException>(error.cause)
    }

    @Test
    fun `a failing dispatch fails the request`() {
        val link = LocalServerLink({ error("boom") })
        val error = assertFailsWith<ExecutionException> { link.request(mapOf("type" to "project_list")).get() }
        assertEquals("boom", error.cause?.message)
    }
}
