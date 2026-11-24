package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** What the image models are sent and what is read back ([OpenAiImages], [GoogleImages]), against a local stand-in. */
class AiImagesTest {
    private val mapper = ObjectMapper()

    private class Received(val path: String, val headers: Map<String, String>, val body: ByteArray) {
        val text: String get() = String(body, Charsets.ISO_8859_1)
    }

    private val received = CopyOnWriteArrayList<Received>()
    private val answers = ArrayDeque<Pair<Int, String>>()
    private val api = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
        createContext("/") { exchange ->
            received += Received(
                exchange.requestURI.path,
                exchange.requestHeaders.mapValues { it.value.joinToString(",") }.mapKeys { it.key.lowercase() },
                exchange.requestBody.readAllBytes(),
            )
            val (status, body) = answers.removeFirst()
            val bytes = body.toByteArray()
            exchange.responseHeaders.add("Content-Type", "application/json")
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        start()
    }
    private val base get() = "http://127.0.0.1:${api.address.port}"
    private val picture = byteArrayOf(1, 2, 3, 4, 5)
    private val encoded = Base64.getEncoder().encodeToString(picture)

    @AfterTest
    fun stop() = api.stop(0)

    private fun json(received: Received): JsonNode = mapper.readTree(received.body)

    @Test
    fun `OpenAI is asked for one PNG of the shape, transparent when asked, and its picture is read`() {
        val model = OpenAiImages(AiImageConfig(provider = "openai", apiKey = "sk-img", baseUrl = "$base/v1"))
        assertEquals("gpt-image-1", model.model)
        assertTrue(model.transparency)
        answers += 200 to """{"data":[{"b64_json":"$encoded"}]}"""
        val made = model.generate(ImageRequest("a red banner", ImageRequest.Shape.WIDE, transparent = true))
        assertContentEquals(picture, made.bytes)
        val sent = received.single()
        assertEquals("/v1/images/generations", sent.path)
        assertEquals("Bearer sk-img", sent.headers["authorization"])
        assertEquals(
            mapOf("model" to "gpt-image-1", "prompt" to "a red banner", "n" to 1, "size" to "1536x1024", "background" to "transparent", "output_format" to "png"),
            mapper.convertValue(json(sent), Map::class.java),
        )

        answers += 200 to """{"data":[{"b64_json":"$encoded"}]}"""
        OpenAiImages(AiImageConfig(provider = "openai", apiKey = "k", model = "gpt-image-2", baseUrl = "$base/v1"))
            .generate(ImageRequest("a field", ImageRequest.Shape.TALL, transparent = false))
        assertEquals(listOf("gpt-image-2", "1024x1536", "opaque"), json(received.last()).let { listOf(it["model"].asText(), it["size"].asText(), it["background"].asText()) })
    }

    @Test
    fun `with references OpenAI is sent a form, each picture as a file`() {
        val model = OpenAiImages(AiImageConfig(provider = "openai", apiKey = "sk-img", baseUrl = "$base/v1"))
        answers += 200 to """{"data":[{"b64_json":"$encoded"}]}"""
        val references = listOf(ImageRequest.Reference("reference-1.png", byteArrayOf(9, 8, 7)), ImageRequest.Reference("reference-2.png", byteArrayOf(6, 5)))
        assertContentEquals(picture, model.generate(ImageRequest("the same, in blue", ImageRequest.Shape.SQUARE, false, references)).bytes)
        val sent = received.single()
        assertEquals("/v1/images/edits", sent.path)
        assertTrue(sent.headers.getValue("content-type").startsWith("multipart/form-data"))
        val form = sent.text
        for ((name, value) in mapOf("model" to "gpt-image-1", "prompt" to "the same, in blue", "n" to "1", "size" to "1024x1024", "background" to "opaque", "output_format" to "png")) {
            assertTrue(Regex("name=\"$name\"\r\n[^\r]*\r\n\r\n${Regex.escape(value)}\r\n").containsMatchIn(form), "$name in $form")
        }
        assertTrue("name=\"image[]\"; filename=\"reference-1.png\"" in form)
        assertTrue("name=\"image[]\"; filename=\"reference-2.png\"" in form)
        assertTrue("Content-Type: image/png" in form)
        assertTrue(String(byteArrayOf(9, 8, 7), Charsets.ISO_8859_1) in form)
    }

    @Test
    fun `a refusal says whose it is, the key, the limit, the request or the provider`() {
        val model = OpenAiImages(AiImageConfig(provider = "openai", apiKey = "k", baseUrl = "$base/v1"))
        val request = ImageRequest("x".repeat(20), ImageRequest.Shape.SQUARE, false)
        fun code(status: Int, body: String): AiFailure {
            answers += status to body
            return assertFailsWith<AiFailure> { model.generate(request) }
        }
        assertEquals("ai_key_refused", code(401, """{"error":{"message":"Incorrect API key"}}""").code)
        assertEquals("ai_rate_limited", code(429, """{"error":{"message":"Slow down"}}""").code)
        val refused = code(400, """{"error":{"message":"Your request was rejected by the safety system"}}""")
        assertEquals("ai_image_refused", refused.code)
        assertTrue("safety system" in refused.message!!)
        assertEquals("ai_provider_error", code(500, "oops").code)
        assertEquals("ai_provider_error", code(200, "<html>").code)
        assertEquals("ai_provider_error", code(200, """{"data":[]}""").code)
        api.stop(0)
        assertEquals("ai_unreachable", assertFailsWith<AiFailure> { model.generate(request) }.code)
    }

    @Test
    fun `Google is asked for an image part, with the shape and the references inline`() {
        val model = GoogleImages(AiImageConfig(provider = "google", apiKey = "g-key", baseUrl = "$base/v1beta"))
        assertEquals("gemini-2.5-flash-image", model.model)
        assertFalse(model.transparency)
        answers += 200 to """{"candidates":[{"content":{"parts":[{"text":"Here it is."},{"inlineData":{"mimeType":"image/png","data":"$encoded"}}]}}]}"""
        val made = model.generate(ImageRequest("a tall tower", ImageRequest.Shape.TALL, false, listOf(ImageRequest.Reference("reference-1.png", byteArrayOf(9, 8, 7)))))
        assertContentEquals(picture, made.bytes)
        val sent = received.single()
        assertEquals("/v1beta/models/gemini-2.5-flash-image:generateContent", sent.path)
        assertEquals("g-key", sent.headers["x-goog-api-key"])
        val body = json(sent)
        val parts = body["contents"][0]["parts"]
        assertEquals("a tall tower", parts[0]["text"].asText())
        assertEquals("image/png", parts[1]["inlineData"]["mimeType"].asText())
        assertEquals(Base64.getEncoder().encodeToString(byteArrayOf(9, 8, 7)), parts[1]["inlineData"]["data"].asText())
        assertEquals(listOf("TEXT", "IMAGE"), body["generationConfig"]["responseModalities"].map { it.asText() })
        assertEquals("2:3", body["generationConfig"]["imageConfig"]["aspectRatio"].asText())

        // Square is the model's own shape: nothing said about it. The other spelling of the part is read too.
        answers += 200 to """{"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/png","data":"$encoded"}}]}}]}"""
        assertContentEquals(picture, model.generate(ImageRequest("a square", ImageRequest.Shape.SQUARE, false)).bytes)
        assertNull(json(received.last())["generationConfig"].get("imageConfig"))
    }

    @Test
    fun `Google answering without a picture is a refusal, with what it said`() {
        val model = GoogleImages(AiImageConfig(provider = "google", apiKey = "g-key", model = "gemini-3-flash-image", baseUrl = "$base/v1beta"))
        val request = ImageRequest("something", ImageRequest.Shape.SQUARE, false)
        answers += 200 to """{"promptFeedback":{"blockReason":"SAFETY"}}"""
        val blocked = assertFailsWith<AiFailure> { model.generate(request) }
        assertEquals("ai_image_refused", blocked.code)
        assertTrue("SAFETY" in blocked.message!!)
        assertEquals("/v1beta/models/gemini-3-flash-image:generateContent", received.single().path)
        answers += 200 to """{"candidates":[{"content":{"parts":[{"text":"I cannot draw that."}]}}]}"""
        val said = assertFailsWith<AiFailure> { model.generate(request) }
        assertEquals("ai_image_refused", said.code)
        assertTrue("I cannot draw that." in said.message!!)
        answers += 403 to """{"error":{"message":"API key not valid"}}"""
        assertEquals("ai_key_refused", assertFailsWith<AiFailure> { model.generate(request) }.code)
    }

    @Test
    fun `the settings name a service only with a known provider and a key`() {
        assertNull(AiImageConfig.service(AiImageConfig()))
        assertNull(AiImageConfig.service(AiImageConfig(provider = "openai")))
        assertNull(AiImageConfig.service(AiImageConfig(provider = "midjourney", apiKey = "k")))
        assertTrue(AiImageConfig.service(AiImageConfig(provider = "openai", apiKey = "k")) is OpenAiImages)
        assertTrue(AiImageConfig.service(AiImageConfig(provider = "google", apiKey = "k")) is GoogleImages)
        assertEquals("my-model", AiImageConfig(provider = "google", apiKey = "k", model = "my-model").usedModel)
        assertEquals(listOf("square", "wide", "tall"), ImageRequest.Shape.entries.map { it.id })
        assertNull(ImageRequest.Shape.of("round"))
    }

    @Test
    fun `each player keeps their last pictures, and has so many a day`() {
        var now = Instant.parse("2026-11-24T23:50:00Z")
        val clock = object : Clock() {
            override fun getZone() = ZoneOffset.UTC
            override fun withZone(zone: java.time.ZoneId?) = this
            override fun instant() = now
        }
        val pictures = GeneratedPictures(clock)
        val (a, b) = UUID.randomUUID() to UUID.randomUUID()
        val names = (1..GeneratedPictures.PER_PLAYER + 2).map { pictures.keep(a, byteArrayOf(it.toByte())) }
        assertEquals("generated-1.png", names.first())
        assertEquals(names.takeLast(GeneratedPictures.PER_PLAYER), pictures.of(a).keys.toList())
        assertTrue(pictures.of(b).isEmpty())
        val mine = pictures.keep(b, byteArrayOf(7))
        assertEquals(setOf(mine), pictures.of(b).keys, "a player's pictures are their own")

        assertTrue(pictures.spend(a, 2))
        assertTrue(pictures.spend(a, 2))
        assertFalse(pictures.spend(a, 2), "the day's limit")
        assertTrue(pictures.spend(b, 2), "counted per player")
        pictures.giveBack(a)
        assertTrue(pictures.spend(a, 2), "a picture that was not made is not counted")
        assertFalse(pictures.spend(a, 2))
        assertTrue(pictures.spend(a, 0), "0: no limit")
        now = Instant.parse("2026-11-25T00:00:01Z")
        assertTrue(pictures.spend(a, 2), "another day")
    }
}
