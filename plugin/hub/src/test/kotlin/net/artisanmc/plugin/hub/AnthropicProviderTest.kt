package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** What [AnthropicProvider] sends to the Messages API and reads back, against a local stand-in. */
class AnthropicProviderTest {
    private val mapper = ObjectMapper()
    private val requests = CopyOnWriteArrayList<JsonNode>()
    private val headers = CopyOnWriteArrayList<Map<String, String>>()
    private val answers = ArrayDeque<Pair<Int, String>>()
    private val api = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/v1/messages") { exchange ->
            requests.add(mapper.readTree(exchange.requestBody))
            headers += exchange.requestHeaders.mapValues { it.value.joinToString(",") }.mapKeys { it.key.lowercase() }
            val (status, body) = answers.removeFirst()
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        start()
    }

    @AfterTest
    fun stop() = api.stop(0)

    private fun provider() = AnthropicProvider(AiConfig(provider = "anthropic", apiKey = "sk-test", baseUrl = "http://127.0.0.1:${api.address.port}"))

    private fun message(content: String, stop: String) = """
        {"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":$content,
         "stop_reason":"$stop","stop_sequence":null,"usage":{"input_tokens":50,"output_tokens":7}}
    """.trimIndent()

    private val tools = McpTools(McpProjects(Servers(McpFixtures.server(mutableListOf())))).tools

    @Test
    fun `a stored history goes on where it stopped, the calls left without result answered as interrupted`() {
        answers += 200 to message("""[{"type":"thinking","thinking":"","signature":"sig"},{"type":"tool_use","id":"toolu_1","name":"read_document","input":{"project":"u-local.shop","path":"menus/shop.yml"}}]""", "tool_use")
        answers += 200 to message("""[{"type":"text","text":"Je reprends."}]""", "end_turn")
        val first = provider().conversation("system prompt", tools)
        first.step(listOf(AiInput.Text("lis le menu")))
        // The hub stops while the tool runs: what was stored is the question and the answer.
        val stored = first.history()!!

        val resumed = provider().resume("system prompt", tools, stored)!!
        assertEquals(mapper.readTree(stored), mapper.readTree(resumed.history()))
        assertEquals(listOf("Je reprends."), resumed.step(listOf(AiInput.Text("tu en étais où ?"))).texts)
        val history = requests[1]["messages"]
        assertEquals(listOf("user", "assistant", "user"), history.map { it["role"].asText() })
        assertEquals("sig", history[1]["content"][0]["signature"].asText(), "the thinking block goes back as it came")
        val (interrupted, text) = history[2]["content"].toList()
        assertEquals("toolu_1", interrupted["tool_use_id"].asText())
        assertTrue(interrupted["is_error"].asBoolean())
        assertEquals("tu en étais où ?", text["text"].asText())

        // A question stored without its answer is sent again with the next one, not twice.
        val unanswered = mapper.readTree(stored).also { (it as com.fasterxml.jackson.databind.node.ArrayNode).add(mapper.readTree("""{"role":"user","content":"perdu"}""")) }
        assertEquals(mapper.readTree(stored), mapper.readTree(provider().resume("system prompt", tools, unanswered.toString())!!.history()))
        assertEquals(null, provider().resume("system prompt", tools, "not json"))
    }

    @Test
    fun `a tool call goes out with the tools, and its result comes back after the answer, unchanged`() {
        answers += 200 to message("""[{"type":"thinking","thinking":"","signature":"sig"},{"type":"tool_use","id":"toolu_1","name":"read_document","input":{"project":"u-local.shop","path":"menus/shop.yml"}}]""", "tool_use")
        answers += 200 to message("""[{"type":"text","text":"Voilà."}]""", "end_turn")
        val conversation = provider().conversation("system prompt", tools)

        val first = conversation.step(listOf(AiInput.Text("lis le menu")))
        assertEquals(AiReply.TOOLS, first.stop)
        assertEquals("read_document", first.toolCalls.single().name)
        assertEquals("menus/shop.yml", first.toolCalls.single().input["path"].asText())
        assertEquals(50, first.inputTokens)

        val second = conversation.step(listOf(AiInput.ToolResult("toolu_1", """{"error":"not_found"}""", error = true)))
        assertEquals(listOf("Voilà."), second.texts)
        assertEquals(AiReply.END, second.stop)

        val sent = requests[0]
        assertEquals("claude-opus-5-5", sent["model"].asText())
        assertEquals("system prompt", sent["system"].asText())
        assertEquals("medium", sent["output_config"]["effort"].asText())
        assertEquals("ephemeral", sent["cache_control"]["type"].asText())
        assertEquals(tools.map { it.name }, sent["tools"].map { it["name"].asText() })
        assertEquals(false, sent["tools"][2]["input_schema"]["additionalProperties"].asBoolean())
        assertEquals("sk-test", headers[0]["x-api-key"])

        // The history: the question, the answer as it came (thinking included), then the result.
        val history = requests[1]["messages"]
        assertEquals(listOf("user", "assistant", "user"), history.map { it["role"].asText() })
        assertEquals("sig", history[1]["content"][0]["signature"].asText())
        val result = history[2]["content"][0]
        assertEquals("tool_result", result["type"].asText())
        assertEquals("toolu_1", result["tool_use_id"].asText())
        assertTrue(result["is_error"].asBoolean())
    }

    @Test
    fun `a refused key, a refusal and a cut answer are told apart`() {
        answers += 401 to """{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"""
        val failure = assertFailsWith<AiFailure> { provider().conversation("s", tools).step(listOf(AiInput.Text("hi"))) }
        assertEquals("ai_key_refused", failure.code)

        answers += 200 to message("[]", "refusal")
        assertEquals(AiReply.REFUSED, provider().conversation("s", tools).step(listOf(AiInput.Text("hi"))).stop)
        answers += 200 to message("""[{"type":"text","text":"Le début"}]""", "max_tokens")
        assertEquals(AiReply.LIMIT, provider().conversation("s", tools).step(listOf(AiInput.Text("hi"))).stop)
    }
}
