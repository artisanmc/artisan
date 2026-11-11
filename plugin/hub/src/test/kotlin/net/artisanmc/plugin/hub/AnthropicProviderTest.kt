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
            val request = mapper.readTree(exchange.requestBody)
            requests.add(request)
            headers += exchange.requestHeaders.mapValues { it.value.joinToString(",") }.mapKeys { it.key.lowercase() }
            val (status, body) = answers.removeFirst()
            val streamed = status == 200 && request.path("stream").asBoolean(false)
            val bytes = (if (streamed) events(body) else body).toByteArray()
            exchange.responseHeaders.add("Content-Type", if (streamed) "text/event-stream" else "application/json")
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

    /** [message] as the API streams it: each block opened, written in pieces, closed. */
    private fun events(message: String): String {
        val m = mapper.readTree(message) as com.fasterxml.jackson.databind.node.ObjectNode
        val out = StringBuilder()
        fun send(type: String, data: Any) {
            out.append("event: ").append(type).append("\ndata: ").append(mapper.writeValueAsString(mapOf("type" to type) + mapper.convertValue(data, Map::class.java).mapKeys { it.key.toString() })).append("\n\n")
        }
        val start = m.deepCopy().apply { putArray("content"); putNull("stop_reason") }
        send("message_start", mapOf("message" to start))
        m["content"].forEachIndexed { i, block ->
            val type = block["type"].asText()
            when (type) {
                "text" -> {
                    send("content_block_start", mapOf("index" to i, "content_block" to mapOf("type" to "text", "text" to "")))
                    val text = block["text"].asText()
                    text.chunked(maxOf(1, text.length / 2 + 1)).forEach { send("content_block_delta", mapOf("index" to i, "delta" to mapOf("type" to "text_delta", "text" to it))) }
                }
                "thinking" -> {
                    send("content_block_start", mapOf("index" to i, "content_block" to mapOf("type" to "thinking", "thinking" to "", "signature" to "")))
                    send("content_block_delta", mapOf("index" to i, "delta" to mapOf("type" to "signature_delta", "signature" to block["signature"].asText())))
                }
                "tool_use" -> {
                    send("content_block_start", mapOf("index" to i, "content_block" to mapOf("type" to "tool_use", "id" to block["id"].asText(), "name" to block["name"].asText(), "input" to emptyMap<String, Any>())))
                    val json = mapper.writeValueAsString(block["input"])
                    json.chunked(maxOf(1, json.length / 2 + 1)).forEach { send("content_block_delta", mapOf("index" to i, "delta" to mapOf("type" to "input_json_delta", "partial_json" to it))) }
                }
            }
            send("content_block_stop", mapOf("index" to i))
        }
        send("message_delta", mapOf("delta" to mapOf("stop_reason" to m["stop_reason"].asText(), "stop_sequence" to null), "usage" to mapOf("output_tokens" to m["usage"]["output_tokens"].asInt())))
        send("message_stop", emptyMap<String, Any>())
        return out.toString()
    }

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
    fun `an attached image and PDF go out as their own blocks, and come back from a stored history`() {
        answers += 200 to message("""[{"type":"text","text":"Je vois."}]""", "end_turn")
        val conversation = provider().conversation("s", tools)
        conversation.step(listOf(AiInput.Image("shot.png", "image/png", "iVBORw0K"), AiInput.Pdf("doc.pdf", "JVBERi0x"), AiInput.Text("refais ça")))
        val (image, pdf, text) = requests.single()["messages"][0]["content"].toList()
        assertEquals("image", image["type"].asText())
        assertEquals("base64", image["source"]["type"].asText())
        assertEquals("image/png", image["source"]["media_type"].asText())
        assertEquals("iVBORw0K", image["source"]["data"].asText())
        assertEquals("document", pdf["type"].asText())
        assertEquals("application/pdf", pdf["source"]["media_type"].asText())
        assertEquals("doc.pdf", pdf["title"].asText())
        assertEquals("refais ça", text["text"].asText())
        val stored = conversation.history()!!
        assertEquals(mapper.readTree(stored), mapper.readTree(provider().resume("s", tools, stored)!!.history()))
    }

    @Test
    fun `an answer streams its text and its tool calls as they are written`() {
        answers += 200 to message("""[{"type":"text","text":"Je lis le menu."},{"type":"tool_use","id":"toolu_1","name":"read_document","input":{"project":"u-local.shop","path":"menus/shop.yml"}}]""", "tool_use")
        val deltas = CopyOnWriteArrayList<AiDelta>()
        val reply = provider().conversation("s", tools).stream(listOf(AiInput.Text("lis"))) { deltas += it }
        assertTrue(requests.single()["stream"].asBoolean(), "asked as a stream")
        assertEquals("Je lis le menu.", deltas.filterIsInstance<AiDelta.Text>().joinToString("") { it.text })
        assertTrue(deltas.filterIsInstance<AiDelta.Text>().size > 1, "in pieces")
        assertEquals(AiDelta.ToolStart("toolu_1", "read_document"), deltas.filterIsInstance<AiDelta.ToolStart>().single())
        val input = deltas.filterIsInstance<AiDelta.ToolInput>().joinToString("") { it.json }
        assertEquals("menus/shop.yml", mapper.readTree(input)["path"].asText())
        // The answer is the same as without a stream.
        assertEquals(listOf("Je lis le menu."), reply.texts)
        assertEquals("menus/shop.yml", reply.toolCalls.single().input["path"].asText())
        assertEquals(AiReply.TOOLS, reply.stop)
        assertEquals(50, reply.inputTokens)
        assertEquals(7, reply.outputTokens)
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
