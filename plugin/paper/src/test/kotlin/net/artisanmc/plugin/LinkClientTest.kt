package net.artisanmc.plugin

import net.artisanmc.plugin.ws.LinkClient
import net.artisanmc.plugin.ws.LinkResult
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class LinkClientTest {

    @Test
    fun `successful redeem returns the server key and network name`() {
        val server = MockWebServer()
        server.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("""{"server_key":"sk_abc","server_key_id":"srv_1","network_name":"My Net"}"""),
        )
        server.start()

        val base = server.url("/").toString().trimEnd('/')
        val result = LinkClient(base).redeem("ABCD1234")

        assertTrue(result is LinkResult.Success)
        result as LinkResult.Success
        assertEquals("sk_abc", result.serverKey)
        assertEquals("My Net", result.networkName)

        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/v1/link/ABCD1234/redeem", req.path)
        server.shutdown()
    }

    @Test
    fun `error response surfaces the backend error code`() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"already_redeemed"}"""))
        server.start()

        val base = server.url("/").toString().trimEnd('/')
        val result = LinkClient(base).redeem("ABCD1234")

        assertTrue(result is LinkResult.Failure)
        assertEquals("already_redeemed", (result as LinkResult.Failure).reason)
        server.shutdown()
    }

    @Test
    fun `unreachable backend yields a network failure`() {
        // Nothing listening on this port → connection refused.
        val result = LinkClient("http://127.0.0.1:1").redeem("ABCD1234")
        assertTrue(result is LinkResult.Failure)
        assertEquals("network", (result as LinkResult.Failure).reason)
    }
}
