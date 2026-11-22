package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The `artisan` provider: each model's protocol, sent to the site's relay with the link's token. */
class CloudProviderTest {
    private val mapper = ObjectMapper()
    private val requests = CopyOnWriteArrayList<Pair<String, JsonNode>>()
    private val headers = CopyOnWriteArrayList<Map<String, String>>()
    private val answers = ArrayDeque<Pair<Int, String>>()
    private val relay = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { exchange ->
            requests += exchange.requestURI.path to mapper.readTree(exchange.requestBody)
            headers += exchange.requestHeaders.mapValues { it.value.joinToString(",") }.mapKeys { it.key.lowercase() }
            val (status, body) = answers.removeFirst()
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", if (status == 200) "text/event-stream" else "application/json")
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        start()
    }

    @AfterTest
    fun stop() = relay.stop(0)

    private val catalogue = """
        {"balance":12.5,"buy":"https://artisanmc.net/account/#ai-credits","models":[
          {"id":"claude","label":"Claude","protocol":"anthropic","attachments":["text","image","pdf"]},
          {"id":"deepseek","label":"DeepSeek","protocol":"openai","attachments":["text"]}]}
    """.trimIndent()

    private inner class Site : SiteApi {
        var asked = 0
        var refuse = false
        override fun startLink(name: String) = throw UnsupportedOperationException()
        override fun collect(deviceCode: String) = throw UnsupportedOperationException()
        override fun updates(token: String, channel: String, installed: Map<String, String>) = throw UnsupportedOperationException()
        override fun ai(token: String): JsonNode {
            asked++
            if (refuse) throw SiteFailure("site_unlinked")
            return mapper.readTree(catalogue)
        }
    }

    private val api = Site()
    private val links = MemorySiteLinkStore(SiteLink("tok-123", "Survival", Instant.EPOCH))
    private val site = SiteAccount("http://127.0.0.1:${relay.address.port}", links, api)

    private fun provider(model: String) = CloudProvider(AiConfig(provider = AiConfig.ARTISAN, model = model), site)

    private fun openAiAnswer(text: String) =
        "data: {\"choices\":[{\"delta\":{\"content\":\"$text\"}}]}\n\n" +
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n" +
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n"

    @Test
    fun `an OpenAI-compatible model goes to the relay with the link's token`() {
        answers += 200 to openAiAnswer("Hello")
        val reply = provider("deepseek").conversation("system", emptyList()).step(listOf(AiInput.Text("Hi")))

        assertEquals(listOf("Hello"), reply.texts)
        val (path, body) = requests.single()
        assertEquals("/api/ai/chat/", path)
        assertEquals("deepseek", body["model"].asText())
        assertEquals("Bearer tok-123", headers.single()["authorization"])
    }

    @Test
    fun `an Anthropic model sends nothing only Anthropic's own API reads`() {
        answers += 200 to anthropicAnswer()
        val tools = McpTools(McpProjects(Servers(McpFixtures.server(mutableListOf())))).tools
        provider("claude").conversation("system", tools).step(listOf(AiInput.Text("Hi")))

        val body = requests.single().second
        assertEquals("claude", body["model"].asText())
        assertFalse(body.has("fallbacks"))
        assertTrue(body["tools"].none { it.has("eager_input_streaming") })
        assertEquals("Bearer tok-123", headers.single()["authorization"])
        assertNull(headers.single()["x-api-key"])
    }

    @Test
    fun `no credits left, or the link refused, says so`() {
        answers += 402 to """{"type":"error","error":{"type":"insufficient_credits","message":"No credits"}}"""
        val chat = provider("deepseek").conversation("system", emptyList())
        assertEquals("ai_no_credits", assertFailsWith<AiFailure> { chat.step(listOf(AiInput.Text("Hi"))) }.code)

        answers += 401 to """{"type":"error","error":{"type":"authentication_error","message":"Not linked"}}"""
        assertEquals("ai_not_linked", assertFailsWith<AiFailure> { chat.step(listOf(AiInput.Text("Hi"))) }.code)
        assertNull(site.link(), "the refused link is forgotten")
        assertEquals("ai_not_linked", assertFailsWith<AiFailure> { chat.step(listOf(AiInput.Text("Hi"))) }.code)
    }

    @Test
    fun `a model the site does not offer, or no link, fails before any call`() {
        assertEquals("ai_cloud_model", assertFailsWith<AiFailure> { provider("gone").conversation("system", emptyList()) }.code)
        links.write(null)
        site.unlink()
        assertEquals("ai_not_linked", assertFailsWith<AiFailure> { provider("deepseek").conversation("system", emptyList()) }.code)
        assertTrue(requests.isEmpty())
    }

    @Test
    fun `the catalogue is asked of the site once a minute and gives the files a model reads`() {
        val claude = provider("claude")
        assertEquals(setOf(AiAttachment.Kind.TEXT), claude.attachments, "text alone before the site answered")
        site.ai()
        site.ai()
        assertEquals(1, api.asked)
        assertEquals(AiAttachment.Kind.entries.toSet(), claude.attachments)
        assertEquals(setOf(AiAttachment.Kind.TEXT), provider("deepseek").attachments)
        assertEquals(12.5, site.ai().balance)
        assertEquals("artisan|claude", claude.historyKey)
    }

    @Test
    fun `a link the site refuses while reading the catalogue is forgotten`() {
        api.refuse = true
        assertEquals("site_not_linked", assertFailsWith<SiteFailure> { site.ai() }.code)
        assertNull(site.link())
    }

    private fun anthropicAnswer(): String {
        fun event(type: String, data: String) = "event: $type\ndata: {\"type\":\"$type\",$data}\n\n"
        return event("message_start", "\"message\":{\"id\":\"m\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"usage\":{\"input_tokens\":5,\"output_tokens\":1}}") +
            event("content_block_start", "\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}") +
            event("content_block_delta", "\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}") +
            event("content_block_stop", "\"index\":0") +
            event("message_delta", "\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}") +
            event("message_stop", "\"x\":0")
    }
}
