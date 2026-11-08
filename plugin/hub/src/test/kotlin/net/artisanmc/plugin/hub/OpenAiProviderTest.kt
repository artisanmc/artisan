package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** What [OpenAiProvider] sends to a Chat Completions API and reads back, against a local stand-in. */
class OpenAiProviderTest {
    private val mapper = ObjectMapper()
    private val requests = CopyOnWriteArrayList<JsonNode>()
    private val headers = CopyOnWriteArrayList<Map<String, String>>()
    private val answers = ArrayDeque<Pair<Int, String>>()
    private val api = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/v1/chat/completions") { exchange ->
            requests.add(mapper.readTree(exchange.requestBody))
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
    fun stop() = api.stop(0)

    private fun provider() = OpenAiProvider(AiConfig(provider = "openai", apiKey = "sk-test", model = "deepseek-chat", baseUrl = "http://127.0.0.1:${api.address.port}/v1"))

    private data class Scripted(val id: String, val name: String, val arguments: String)

    /** An answer as a compatible API streams it: text in pieces, each call's arguments in pieces, then the usage. */
    private fun stream(text: String = "", calls: List<Scripted> = emptyList(), finish: String = "stop", reasoning: String = ""): String {
        val out = StringBuilder()
        fun chunk(delta: Map<String, Any?>, finishReason: String? = null) {
            val choice = mapOf("index" to 0, "delta" to delta, "finish_reason" to finishReason)
            out.append("data: ").append(mapper.writeValueAsString(mapOf("id" to "c1", "object" to "chat.completion.chunk", "choices" to listOf(choice)))).append("\n\n")
        }
        chunk(mapOf("role" to "assistant", "content" to ""))
        if (reasoning.isNotEmpty()) chunk(mapOf("reasoning_content" to reasoning))
        text.chunked(maxOf(1, text.length / 2 + 1)).filter { it.isNotEmpty() }.forEach { chunk(mapOf("content" to it)) }
        calls.forEachIndexed { i, call ->
            chunk(mapOf("tool_calls" to listOf(mapOf("index" to i, "id" to call.id, "type" to "function", "function" to mapOf("name" to call.name, "arguments" to "")))))
            call.arguments.chunked(maxOf(1, call.arguments.length / 2 + 1)).forEach {
                chunk(mapOf("tool_calls" to listOf(mapOf("index" to i, "function" to mapOf("arguments" to it)))))
            }
        }
        chunk(emptyMap(), finish)
        out.append("data: ").append(mapper.writeValueAsString(mapOf("choices" to emptyList<Any>(), "usage" to mapOf("prompt_tokens" to 50, "completion_tokens" to 7)))).append("\n\n")
        out.append("data: [DONE]\n\n")
        return out.toString()
    }

    private val tools = McpTools(McpProjects(Servers(McpFixtures.server(mutableListOf())))).tools

    private val read = Scripted("call_1", "read_document", """{"project":"u-local.shop","path":"menus/shop.yml"}""")

    @Test
    fun `a tool call streams, goes out with the tools, and its result comes back as a tool message`() {
        answers += 200 to stream(text = "Je lis le menu.", calls = listOf(read), finish = "tool_calls")
        answers += 200 to stream(text = "Voilà.")
        val conversation = provider().conversation("system prompt", tools)
        val deltas = CopyOnWriteArrayList<AiDelta>()

        val first = conversation.stream(listOf(AiInput.Text("lis le menu"))) { deltas += it }
        assertEquals(AiReply.TOOLS, first.stop)
        assertEquals(listOf("Je lis le menu."), first.texts)
        assertEquals("menus/shop.yml", first.toolCalls.single().input["path"].asText())
        assertEquals(50, first.inputTokens)
        assertEquals(7, first.outputTokens)
        assertEquals("Je lis le menu.", deltas.filterIsInstance<AiDelta.Text>().joinToString("") { it.text })
        assertEquals(AiDelta.ToolStart("call_1", "read_document"), deltas.filterIsInstance<AiDelta.ToolStart>().single())
        assertEquals("menus/shop.yml", mapper.readTree(deltas.filterIsInstance<AiDelta.ToolInput>().joinToString("") { it.json })["path"].asText())

        val second = conversation.step(listOf(AiInput.ToolResult("call_1", """{"error":"not_found"}""", error = true)))
        assertEquals(listOf("Voilà."), second.texts)
        assertEquals(AiReply.END, second.stop)

        val sent = requests[0]
        assertEquals("deepseek-chat", sent["model"].asText())
        assertTrue(sent["stream"].asBoolean())
        assertTrue(sent["stream_options"]["include_usage"].asBoolean())
        assertFalse(sent.has("max_tokens"), "no cap: each vendor has its own")
        assertEquals("Bearer sk-test", headers[0]["authorization"])
        assertEquals(tools.map { it.name }, sent["tools"].map { it["function"]["name"].asText() })
        assertEquals("function", sent["tools"][0]["type"].asText())
        assertEquals(listOf("system", "user"), sent["messages"].map { it["role"].asText() })
        assertEquals("system prompt", sent["messages"][0]["content"].asText())
        assertEquals("lis le menu", sent["messages"][1]["content"].asText(), "plain text as a string")

        val history = requests[1]["messages"]
        assertEquals(listOf("system", "user", "assistant", "tool"), history.map { it["role"].asText() })
        val call = history[2]["tool_calls"].single()
        assertEquals("call_1", call["id"].asText())
        assertEquals(read.arguments, call["function"]["arguments"].asText(), "the arguments go back as they came")
        assertEquals("call_1", history[3]["tool_call_id"].asText())
        assertEquals("""{"error":"not_found"}""", history[3]["content"].asText())
    }

    @Test
    fun `a stored history goes on where it stopped, the calls left without result answered as interrupted`() {
        answers += 200 to stream(calls = listOf(read), finish = "tool_calls", reasoning = "Il faut lire le menu.")
        answers += 200 to stream(text = "Je reprends.")
        val first = provider().conversation("system prompt", tools)
        first.step(listOf(AiInput.Text("lis le menu")))
        val stored = first.history()!!
        assertEquals("Il faut lire le menu.", mapper.readTree(stored)[1]["reasoning_content"].asText(), "the reasoning goes back within the turn")

        val resumed = provider().resume("system prompt", tools, stored)!!
        assertEquals(mapper.readTree(stored), mapper.readTree(resumed.history()))
        assertEquals(listOf("Je reprends."), resumed.step(listOf(AiInput.Text("tu en étais où ?"))).texts)
        val history = requests[1]["messages"]
        assertEquals(listOf("system", "user", "assistant", "tool", "user"), history.map { it["role"].asText() })
        assertEquals("call_1", history[3]["tool_call_id"].asText())
        assertTrue(history[3]["content"].asText().contains("interrupted"))
        assertEquals("tu en étais où ?", history[4]["content"].asText())

        // A question or a result stored without its answer is sent again with the next one, not twice.
        val unanswered = mapper.readTree(stored).also {
            (it as ArrayNode).add(mapper.readTree("""{"role":"tool","tool_call_id":"call_1","content":"{}"}"""))
            it.add(mapper.readTree("""{"role":"user","content":"perdu"}"""))
        }
        assertEquals(mapper.readTree(stored), mapper.readTree(provider().resume("system prompt", tools, unanswered.toString())!!.history()))
        assertNull(provider().resume("system prompt", tools, "not json"))
    }

    @Test
    fun `an attached image goes out as a data URL beside the text`() {
        answers += 200 to stream(text = "Je vois.")
        provider().conversation("s", tools).step(listOf(AiInput.Image("shot.png", "image/png", "iVBORw0K"), AiInput.Text("refais ça")))
        val (image, text) = requests.single()["messages"][1]["content"].toList()
        assertEquals("image_url", image["type"].asText())
        assertEquals("data:image/png;base64,iVBORw0K", image["image_url"]["url"].asText())
        assertEquals("refais ça", text["text"].asText())
    }

    @Test
    fun `each vendor says which files it reads`() {
        fun kinds(url: String) = OpenAiProvider(AiConfig("openai", "k", "m", baseUrl = url)).attachments
        assertEquals(setOf(AiAttachment.Kind.TEXT), kinds("https://api.deepseek.com"))
        assertEquals(AiAttachment.Kind.entries.toSet(), kinds(""))
        assertEquals(AiAttachment.Kind.entries.toSet(), kinds("https://openrouter.ai/api/v1"))
        assertEquals(setOf(AiAttachment.Kind.TEXT, AiAttachment.Kind.IMAGE), kinds("https://api.mistral.ai/v1"))
        assertEquals(AiAttachment.Kind.entries.toSet(), AnthropicProvider(AiConfig("anthropic", "k")).attachments)
    }

    @Test
    fun `a refused key, a spent balance, a filtered and a cut answer are told apart`() {
        answers += 401 to """{"error":{"message":"Authentication Fails","type":"authentication_error"}}"""
        assertEquals("ai_key_refused", assertFailsWith<AiFailure> { provider().conversation("s", tools).step(listOf(AiInput.Text("hi"))) }.code)
        answers += 402 to """{"error":{"message":"Insufficient Balance"}}"""
        assertEquals("ai_rate_limited", assertFailsWith<AiFailure> { provider().conversation("s", tools).step(listOf(AiInput.Text("hi"))) }.code)
        answers += 500 to """{"error":"model not found"}"""
        val failure = assertFailsWith<AiFailure> { provider().conversation("s", tools).step(listOf(AiInput.Text("hi"))) }
        assertEquals("ai_provider_error", failure.code)
        assertTrue(failure.message!!.contains("model not found"))

        answers += 200 to stream(finish = "content_filter")
        assertEquals(AiReply.REFUSED, provider().conversation("s", tools).step(listOf(AiInput.Text("hi"))).stop)
        answers += 200 to stream(text = "Le début", finish = "length")
        assertEquals(AiReply.LIMIT, provider().conversation("s", tools).step(listOf(AiInput.Text("hi"))).stop)

        // A failed step leaves the history as it was: the message goes again with the next one.
        answers += 429 to """{"error":{"message":"slow down"}}"""
        val conversation = provider().conversation("s", tools)
        assertFailsWith<AiFailure> { conversation.step(listOf(AiInput.Text("hi"))) }
        assertEquals("[]", conversation.history())
    }
}
