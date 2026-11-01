package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.Collections
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The editor's assistant end to end (ADR `editor-assistant`), on a scripted model. */
class AiAssistantTest {
    private val mapper = ObjectMapper()

    /** Answers with [script], one reply per step, and records what each step was given. */
    private class ScriptedModel(vararg script: AiReply) : AiProvider {
        val replies = ArrayDeque(script.toList())
        val inputs = CopyOnWriteArrayList<List<AiInput>>()
        val systems = CopyOnWriteArrayList<String>()
        @Volatile var gate: CountDownLatch? = null
        override val model = "scripted"
        override fun conversation(system: String, tools: List<McpTools.Tool>): AiConversation {
            systems += system
            return object : AiConversation {
                override fun step(input: List<AiInput>): AiReply {
                    inputs += input
                    gate?.await(5, TimeUnit.SECONDS)
                    return replies.removeFirstOrNull() ?: AiReply(listOf("(no more script)"), emptyList(), AiReply.END)
                }
            }
        }
    }

    /** Remembers each text it was sent, and gives that history to the store. */
    private class RememberingModel(override val historyKey: String = "remembering") : AiProvider {
        val inputs = CopyOnWriteArrayList<List<AiInput>>()
        val resumed = CopyOnWriteArrayList<String>()
        override val model = "remembering"
        override fun conversation(system: String, tools: List<McpTools.Tool>): AiConversation = chat(mutableListOf())
        override fun resume(system: String, tools: List<McpTools.Tool>, history: String): AiConversation {
            resumed += history
            return chat(ObjectMapper().readValue(history, Array<String>::class.java).toMutableList())
        }

        private fun chat(seen: MutableList<String>) = object : AiConversation {
            override fun step(input: List<AiInput>): AiReply {
                inputs += input
                input.filterIsInstance<AiInput.Text>().forEach { seen += it.text }
                return AiReply(listOf("Vu ${seen.size}"), emptyList(), AiReply.END, 10, 2)
            }

            override fun history(): String = ObjectMapper().writeValueAsString(seen)
        }
    }

    private fun calls(vararg calls: Pair<String, Map<String, Any?>>) = AiReply(
        emptyList(),
        calls.mapIndexed { i, (name, input) -> AiToolCall("call_$name$i", name, mapper.valueToTree(input)) },
        AiReply.TOOLS,
    )

    private val sent: MutableList<Map<String, Any?>> = Collections.synchronizedList(mutableListOf())
    private val drafts = McpFixtures.Drafts()
    private val sessions = Sessions()
    private val player = UUID.randomUUID()
    private val client = HttpClient.newHttpClient()
    private var hub: HubServer? = null
    private lateinit var cookie: String
    private val base get() = "http://127.0.0.1:${hub!!.port}"

    private fun start(
        model: AiProvider?,
        permissions: Set<String> = EditorPermissions.ALL.toSet(),
        settings: AiSettingsStore? = null,
        ai: AiConfig = AiConfig(),
        conversations: AiConversationStore? = null,
    ) {
        hub = HubServer(
            WebConfig(port = 0, bind = "127.0.0.1"),
            EditorApi.router(Servers(McpFixtures.server(sent)), sessions, null, drafts = drafts, ai = ai, aiSettings = settings, aiProvider = model, aiConversations = conversations),
            sessions, EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
        ).also { it.start() }
        // Started again (a restart): the session stays.
        if (!::cookie.isInitialized) cookie = signIn(player, "Iban", permissions)
    }

    private fun signIn(id: UUID, name: String, permissions: Set<String>): String {
        val token = (sessions.issueLink(id, name, permissions, origin = "u-local") as Sessions.LinkResult.Issued).token
        return "${HubServer.COOKIE}=" + sessions.redeem(token)!!.id
    }

    @BeforeTest
    fun reset() = sent.clear()

    @AfterTest
    fun stop() {
        hub?.stop()
    }

    private class Answer(val status: Int, val body: JsonNode?)

    private fun editor(method: String, path: String, body: Any? = null, as_: String = cookie): Answer {
        val publisher = body?.let { HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(it)) } ?: HttpRequest.BodyPublishers.noBody()
        val request = HttpRequest.newBuilder(URI("$base$path")).method(method, publisher)
            .header("Cookie", as_).header("Content-Type", "application/json").build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        return Answer(response.statusCode(), runCatching { mapper.readTree(response.body()) }.getOrNull())
    }

    private fun conversation(project: String? = "u-local.shop"): String {
        val created = editor("POST", AiRoutes.CONVERSATIONS, mapOf("project" to project))
        assertEquals(201, created.status, created.body.toString())
        return created.body!!["id"].asText()
    }

    /** Waits for the turn to end and returns every event. */
    private fun finished(id: String): List<JsonNode> {
        val deadline = System.currentTimeMillis() + 5000
        while (System.currentTimeMillis() < deadline) {
            val read = editor("GET", "${AiRoutes.CONVERSATIONS}/$id")
            if (!read.body!!["running"].asBoolean()) return read.body["events"].toList()
            Thread.sleep(20)
        }
        error("the assistant did not finish")
    }

    @Test
    fun `the assistant writes a checked draft for the player and never deploys`() {
        val model = ScriptedModel(
            calls("artisan_overview" to emptyMap()),
            calls("start_draft" to mapOf("project" to "u-local.shop", "name" to "AI: VIP")),
            AiReply(listOf("C'est fait : ouvre « AI: VIP » dans Brouillons."), emptyList(), AiReply.END, 120, 40),
        )
        start(model)
        val id = conversation()
        // The first step waits: a second message meanwhile is refused.
        model.gate = CountDownLatch(1)
        assertEquals(202, editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "Fais-moi un menu VIP")).status)
        assertEquals(409, editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "encore")).status, "one turn at a time")
        model.gate!!.countDown()
        model.gate = null
        val events = finished(id)

        val draft = drafts.rows.values.single().let(mapper::readTree)
        assertEquals("ai", draft["source"].asText())
        assertEquals("AI: VIP", draft["name"].asText())
        assertEquals(listOf("user", "tool", "tool", "text", "done"), events.map { it["type"].asText() })
        val started = events.first { it["name"]?.asText() == "start_draft" }
        assertEquals(draft["id"].asText(), started["draft"]["id"].asText(), "the editor can open the draft")
        assertEquals(120, events.last()["inputTokens"].asInt())
        // Each tool's result went back to the model.
        val results = model.inputs.drop(1).map { it.single() as AiInput.ToolResult }
        assertEquals(listOf(false, false), results.map { it.error })
        assertTrue("u-local.shop" in model.systems.single(), "the open Project is in the system prompt")
        assertTrue(sent.none { it["type"] == "project_write" || it["type"] == "project_draft_publish" }, "nothing deployed")
    }

    @Test
    fun `a file the server would not load comes back to the model, and the draft keeps its content`() {
        val model = object : AiProvider {
            override val model = "scripted"
            val results = CopyOnWriteArrayList<AiInput.ToolResult>()
            override fun conversation(system: String, tools: List<McpTools.Tool>) = object : AiConversation {
                var draftId = ""
                override fun step(input: List<AiInput>): AiReply {
                    input.filterIsInstance<AiInput.ToolResult>().forEach { result ->
                        results += result
                        mapper.readTree(result.json).path("draft_id").takeIf { it.isTextual }?.let { draftId = it.asText() }
                    }
                    return when (results.size) {
                        0 -> calls("start_draft" to mapOf("project" to "u-local.shop", "name" to "AI: bad"))
                        1 -> calls("write_document" to mapOf("project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/x.yml", "content" to "schema: menu/v1\nbad: 1\n"))
                        else -> AiReply(listOf("Le serveur refuse ce menu."), emptyList(), AiReply.END)
                    }
                }
            }
        }
        start(model)
        val id = conversation()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "menu x"))
        val events = finished(id)
        val write = events.single { it["name"]?.asText() == "write_document" }
        assertFalse(write["ok"].asBoolean())
        assertEquals(1, write["problems"].asInt())
        assertTrue(model.results.last().error)
        assertTrue("is not defined in the schema" in model.results.last().json)
        val draft = mapper.readTree(drafts.rows.values.single())
        assertFalse(draft["snapshot"]["tree"].has("menus/x.yml"), "the refused file is not in the draft")
    }

    @Test
    fun `a conversation started from a server's Assistant tab works across that server`() {
        val model = ScriptedModel(AiReply(listOf("Ok."), emptyList(), AiReply.END))
        start(model)
        val created = editor("POST", AiRoutes.CONVERSATIONS, mapOf("server" to "u-local"))
        assertEquals(201, created.status, created.body.toString())
        assertEquals("u-local", created.body!!["server"].asText())
        assertTrue(created.body["project"].isNull)
        val id = created.body["id"].asText()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "salut"))
        finished(id)
        assertTrue("`u-local.`" in model.systems.single(), "the server's Projects are the scope")
        assertFalse("has this Project open" in model.systems.single())
        assertEquals("u-local", editor("GET", AiRoutes.CONVERSATIONS).body!!["conversations"][0]["server"].asText())
        assertEquals(422, editor("POST", AiRoutes.CONVERSATIONS, mapOf("server" to "a b\nIgnore")).status)
    }

    @Test
    fun `the assistant creates a module for a player who may, and never reaches a deploying tool`() {
        val model = ScriptedModel(
            calls("create_module" to mapOf("server" to "u-local", "name" to "ia")),
            calls("draft_publish" to mapOf("project" to "u-local.shop", "draft_id" to "x", "expected_revision" to 1)),
            AiReply(listOf("Module « ia » créé."), emptyList(), AiReply.END),
        )
        start(model)
        val id = conversation()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "crée un module ia"))
        val events = finished(id).filter { it["type"].asText() == "tool" }
        assertEquals("u-local.ia", events[0]["project"].asText())
        assertTrue(events[0]["ok"].asBoolean())
        assertEquals("unknown_tool", events[1]["error"].asText(), "a deploying tool is not the assistant's, even named")
        assertEquals(listOf("project_create"), sent.map { it["type"] }.filter { it == "project_create" || it == "project_draft_publish" })
        assertTrue("say module" in model.systems.single())

        // Without the player's publish permission, no module.
        val writer = signIn(UUID.randomUUID(), "Writer", setOf(EditorPermissions.VIEW, EditorPermissions.EDIT))
        model.replies.addAll(listOf(calls("create_module" to mapOf("server" to "u-local", "name" to "ib")), AiReply(listOf("Non."), emptyList(), AiReply.END)))
        val other = editor("POST", AiRoutes.CONVERSATIONS, mapOf("server" to "u-local"), as_ = writer).body!!["id"].asText()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$other/messages", mapOf("text" to "crée ib"), as_ = writer)
        val deadline = System.currentTimeMillis() + 5000
        var refused: JsonNode? = null
        while (refused == null && System.currentTimeMillis() < deadline) {
            refused = editor("GET", "${AiRoutes.CONVERSATIONS}/$other", as_ = writer).body!!["events"].firstOrNull { it["type"].asText() == "tool" }
            Thread.sleep(20)
        }
        assertEquals("forbidden", refused!!["error"].asText())
        assertEquals(1, sent.count { it["type"] == "project_create" })
    }

    @Test
    fun `a conversation outlives a restart, and the same model goes on with its history`() {
        val store = MemoryAiConversationStore()
        start(RememberingModel(), conversations = store)
        val id = conversation()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "Un menu VIP"))
        finished(id)
        hub!!.stop()

        val model = RememberingModel()
        start(model, conversations = store)
        val listed = editor("GET", AiRoutes.CONVERSATIONS).body!!["conversations"].single()
        assertEquals(id, listed["id"].asText())
        assertEquals("Un menu VIP", listed["title"].asText())
        assertEquals(10, listed["inputTokens"].asInt())
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "Et une commande"))
        val events = finished(id)
        assertEquals(listOf("user", "text", "done", "user", "text", "done"), events.map { it["type"].asText() })
        assertEquals("Vu 2", events[4]["text"].asText(), "the model had the first message")
        assertEquals(listOf("""["Un menu VIP"]"""), model.resumed)
        assertEquals(listOf<AiInput>(AiInput.Text("Et une commande")), model.inputs.single(), "no transcript: the history went on")
        assertEquals(20, events.last()["inputTokens"].asInt())

        assertEquals(200, editor("DELETE", "${AiRoutes.CONVERSATIONS}/$id").status)
        assertTrue(store.records.isEmpty())
    }

    @Test
    fun `another model starts again from a transcript of the conversation`() {
        val store = MemoryAiConversationStore()
        start(RememberingModel("first"), conversations = store)
        val id = conversation()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "Un menu VIP"))
        finished(id)
        hub!!.stop()

        val other = RememberingModel("second")
        start(other, conversations = store)
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "Et ensuite ?"))
        finished(id)
        assertTrue(other.resumed.isEmpty())
        val (transcript, message) = other.inputs.single().map { (it as AiInput.Text).text }
        assertTrue("Player: Un menu VIP\nYou: Vu 1" in transcript, transcript)
        assertFalse("Et ensuite" in transcript)
        assertEquals("Et ensuite ?", message)
        assertEquals("second", store.records.getValue(id).historyKey!!.substringBefore('|'), "its own history from now on")
    }

    @Test
    fun `a turn a restart cut short ends with a notice`() {
        val store = MemoryAiConversationStore()
        val at = java.time.Instant.now()
        store.save(AiConversationRecord("c1", player, "u-local.shop", null, "menu", at, at, 0, 0, events = """[{"seq":0,"type":"user","text":"menu"}]"""))
        store.save(AiConversationRecord("c2", UUID.randomUUID(), null, "u-local", "autre", at, at, 0, 0))
        start(RememberingModel(), conversations = store)
        assertEquals(listOf("c1"), editor("GET", AiRoutes.CONVERSATIONS).body!!["conversations"].map { it["id"].asText() })
        assertEquals(404, editor("GET", "${AiRoutes.CONVERSATIONS}/c2").status, "another player's")
        val events = editor("GET", "${AiRoutes.CONVERSATIONS}/c1").body!!["events"]
        assertEquals(listOf("user", "notice", "done"), events.map { it["type"].asText() })
        assertEquals("ai_interrupted", events[1]["code"].asText())
        assertTrue("ai_interrupted" in store.records.getValue("c1").events, "saved once ended")
    }

    @Test
    fun `the missing translations come back checked, a broken placeholder left missing`() {
        val answer = """Voilà :
            {"t1": {"en": "Welcome {player}", "es": "Bienvenido {jugador}"}, "t2": {"en": "Back", "es": "Volver"}}"""
        val model = ScriptedModel(AiReply(listOf(answer), emptyList(), AiReply.END, 30, 12))
        start(model)
        val body = mapOf(
            "source" to "fr", "targets" to listOf("en", "es"), "module" to "u-local.shop",
            "texts" to listOf(mapOf("id" to "t1", "text" to "Bienvenue {player}", "context" to "menus/shop.yml › title"), mapOf("id" to "t2", "text" to "Retour")),
        )
        val result = editor("POST", AiRoutes.TRANSLATE, body)
        assertEquals(200, result.status, result.body.toString())
        assertEquals("Welcome {player}", result.body!!["translations"]["t1"]["en"].asText())
        assertFalse(result.body["translations"]["t1"].has("es"), "{jugador} is not {player}")
        assertEquals("Volver", result.body["translations"]["t2"]["es"].asText())
        assertEquals(listOf("t1"), result.body["failed"].map { it.asText() })
        assertEquals(30, result.body["inputTokens"].asInt())
        val sent = mapper.readTree((model.inputs.single().single() as AiInput.Text).text)
        assertEquals("menus/shop.yml › title", sent["texts"][0]["context"].asText())
        assertTrue("placeholder" in model.systems.single())

        assertEquals(422, editor("POST", AiRoutes.TRANSLATE, body + ("targets" to listOf("fr"))).status, "the source is no target")
        assertEquals(422, editor("POST", AiRoutes.TRANSLATE, body + ("texts" to emptyList<Any>())).status)
        model.replies += AiReply(listOf("Je ne peux pas."), emptyList(), AiReply.END)
        assertEquals("ai_bad_answer", editor("POST", AiRoutes.TRANSLATE, body).body!!["error"].asText())
        val viewer = signIn(UUID.randomUUID(), "Viewer", setOf(EditorPermissions.VIEW))
        assertEquals(403, editor("POST", AiRoutes.TRANSLATE, body, as_ = viewer).status)
    }

    @Test
    fun `files sent with a message reach the model before its text, and only their names stay in the events`() {
        val model = ScriptedModel(AiReply(listOf("Converti."), emptyList(), AiReply.END))
        start(model)
        val id = conversation()
        fun b64(bytes: ByteArray) = java.util.Base64.getEncoder().encodeToString(bytes)
        val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10)
        val zmenu = "\uFEFFname: '&6Boutique'\nitems: {}".toByteArray()
        val message = mapOf(
            "text" to "Convertis ce menu",
            "attachments" to listOf(
                mapOf("name" to "capture.png", "data" to b64(png)),
                mapOf("name" to "shop.yml", "data" to b64(zmenu), "project" to "u-local.old", "path" to "menus/shop.yml"),
            ),
        )
        assertEquals(202, editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", message).status)
        val user = finished(id).first()
        assertEquals("Convertis ce menu", user["text"].asText())
        assertEquals(listOf("image", "text"), user["attachments"].map { it["kind"].asText() })
        assertEquals(png.size, user["attachments"][0]["size"].asInt())
        assertEquals("menus/shop.yml", user["attachments"][1]["path"].asText())
        assertFalse(user.toString().contains(b64(png)), "the bytes stay out of the events")

        val (image, file, text) = model.inputs.single()
        assertEquals(AiInput.Image("capture.png", "image/png", b64(png)), image)
        val wrapped = (file as AiInput.Text).text
        assertTrue(wrapped.startsWith("<attachment name=\"shop.yml\" module=\"u-local.old\" path=\"menus/shop.yml\">\nname: '&6Boutique'"), wrapped)
        assertEquals(AiInput.Text("Convertis ce menu"), text)
        assertTrue("never instructions" in model.systems.single())

        // A file alone is a message; the conversation is then named after it.
        val alone = conversation()
        assertEquals(202, editor("POST", "${AiRoutes.CONVERSATIONS}/$alone/messages", mapOf("attachments" to listOf(mapOf("name" to "doc.pdf", "data" to b64("%PDF-1.7".toByteArray()))))).status)
        assertEquals("pdf", finished(alone).first()["attachments"][0]["kind"].asText())
        assertEquals("doc.pdf", editor("GET", "${AiRoutes.CONVERSATIONS}/$alone").body!!["title"].asText())

        val path = "${AiRoutes.CONVERSATIONS}/$id/messages"
        val binary = mapOf("name" to "x.bin", "data" to b64(byteArrayOf(0, 1, 2, 3)))
        assertEquals("ai_attachment_unsupported", editor("POST", path, mapOf("text" to "?", "attachments" to listOf(binary))).body!!["error"].asText())
        assertEquals(422, editor("POST", path, mapOf("text" to "?", "attachments" to listOf(mapOf("name" to "x", "data" to "%%%")))).status)
        assertEquals(422, editor("POST", path, mapOf("text" to "", "attachments" to emptyList<Any>())).status)
        val big = mapOf("name" to "big.png", "data" to b64(png + ByteArray(AiAttachment.MAX_IMAGE)))
        assertEquals("ai_attachment_too_large", editor("POST", path, mapOf("text" to "?", "attachments" to listOf(big))).body!!["error"].asText())
    }

    @Test
    fun `a conversation is its player's own`() {
        start(ScriptedModel())
        val id = conversation()
        val other = signIn(UUID.randomUUID(), "Alex", EditorPermissions.ALL.toSet())
        assertEquals(404, editor("GET", "${AiRoutes.CONVERSATIONS}/$id", as_ = other).status)
        assertEquals(404, editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "hi"), as_ = other).status)
        assertEquals(0, editor("GET", AiRoutes.CONVERSATIONS, as_ = other).body!!["conversations"].size())
        assertEquals(1, editor("GET", AiRoutes.CONVERSATIONS).body!!["conversations"].size())
    }

    @Test
    fun `talking to the assistant needs edit, and stops at the step limit`() {
        start(ScriptedModel(*Array(30) { calls("artisan_overview" to emptyMap()) }))
        val viewer = signIn(UUID.randomUUID(), "Viewer", setOf(EditorPermissions.VIEW))
        val status = editor("GET", AiRoutes.STATUS, as_ = viewer).body!!
        assertTrue(status["enabled"].asBoolean())
        assertFalse(status["canUse"].asBoolean())
        assertEquals(403, editor("POST", AiRoutes.CONVERSATIONS, mapOf<String, Any>(), as_ = viewer).status)

        val id = conversation()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "boucle"))
        val events = finished(id)
        assertEquals(25, events.count { it["type"].asText() == "tool" })
        assertEquals("ai_step_limit", events.single { it["type"].asText() == "notice" }["code"].asText())
    }

    @Test
    fun `without an ai section the editor is told there is no assistant`() {
        start(null)
        val status = editor("GET", AiRoutes.STATUS).body!!
        assertFalse(status["enabled"].asBoolean())
        assertEquals(404, editor("POST", AiRoutes.CONVERSATIONS, mapOf<String, Any>()).status)
    }

    @Test
    fun `a provider failure ends the turn with its code`() {
        start(object : AiProvider {
            override val model = "failing"
            override fun conversation(system: String, tools: List<McpTools.Tool>) = object : AiConversation {
                override fun step(input: List<AiInput>): AiReply = throw AiFailure("ai_key_refused", "bad key")
            }
        })
        val id = conversation()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "hello"))
        val events = finished(id)
        assertEquals(listOf("user", "error", "done"), events.map { it["type"].asText() })
        assertEquals("ai_key_refused", events[1]["code"].asText())
    }

    private fun settings(vararg fields: Pair<String, Any?>) = mapOf(
        "provider" to "anthropic", "model" to "deepseek-chat", "effort" to "medium", "maxSteps" to 25,
        "baseUrl" to "https://api.deepseek.com/anthropic",
    ) + fields

    @Test
    fun `settings saved from the editor turn the assistant on at once, and the key never comes back`() {
        val store = MemoryAiSettingsStore()
        start(ScriptedModel(AiReply(listOf("Bonjour"), emptyList(), AiReply.END)), settings = store)
        assertFalse(editor("GET", AiRoutes.STATUS).body!!["enabled"].asBoolean())
        val empty = editor("GET", AiRoutes.CONFIG_PATH).body!!
        assertEquals("none", empty["source"].asText())
        assertTrue(empty["editable"].asBoolean())

        assertEquals("ai_key_missing", editor("PUT", AiRoutes.CONFIG_PATH, settings()).body!!["error"].asText())
        assertEquals(422, editor("PUT", AiRoutes.CONFIG_PATH, settings("baseUrl" to "file:///etc/passwd", "apiKey" to "sk-x")).status)
        val saved = editor("PUT", AiRoutes.CONFIG_PATH, settings("apiKey" to "sk-secret-123456789"))
        assertEquals(200, saved.status, saved.body.toString())
        assertEquals("database", saved.body!!["source"].asText())
        assertEquals("…6789", saved.body["keyHint"].asText())
        assertFalse("sk-secret" in saved.body.toString(), "the key is never sent back")
        assertEquals("sk-secret-123456789", store.read()!!.apiKey)
        assertTrue(editor("GET", AiRoutes.STATUS).body!!["enabled"].asBoolean(), "no restart needed")

        // Left out, the key stays; sent elsewhere, it must be typed again.
        assertEquals(200, editor("PUT", AiRoutes.CONFIG_PATH, settings("model" to "deepseek-reasoner")).status)
        assertEquals("sk-secret-123456789", store.read()!!.apiKey)
        assertEquals("deepseek-reasoner", store.read()!!.model)
        val moved = editor("PUT", AiRoutes.CONFIG_PATH, settings("baseUrl" to "https://evil.example"))
        assertEquals("ai_key_required", moved.body!!["error"].asText())
        assertEquals("https://api.deepseek.com/anthropic", store.read()!!.baseUrl)

        val id = conversation()
        editor("POST", "${AiRoutes.CONVERSATIONS}/$id/messages", mapOf("text" to "Salut"))
        assertEquals("Bonjour", finished(id).first { it["type"].asText() == "text" }["text"].asText())

        assertEquals(200, editor("DELETE", AiRoutes.CONFIG_PATH).status)
        assertNull(store.read())
        assertFalse(editor("GET", AiRoutes.STATUS).body!!["enabled"].asBoolean())
    }

    @Test
    fun `environment yml wins and the editor shows it read-only`() {
        start(
            ScriptedModel(),
            settings = MemoryAiSettingsStore(AiConfig("anthropic", "sk-database-key", "from-database")),
            ai = AiConfig("anthropic", "sk-file-key-abcdef", "from-file"),
        )
        val config = editor("GET", AiRoutes.CONFIG_PATH).body!!
        assertEquals("file", config["source"].asText())
        assertFalse(config["editable"].asBoolean())
        assertEquals("from-file", config["model"].asText())
        assertEquals(409, editor("PUT", AiRoutes.CONFIG_PATH, settings("apiKey" to "sk-other")).status)
        assertEquals(409, editor("DELETE", AiRoutes.CONFIG_PATH).status)
    }

    @Test
    fun `the settings need config, and wait for the database`() {
        var open = false
        val store = object : AiSettingsStore {
            val saved = AiConfig("anthropic", "sk-database-key", "saved")
            override fun read(): AiConfig? = if (open) saved else throw IllegalStateException("not open")
            override fun write(config: AiConfig?) = throw IllegalStateException("not open")
        }
        start(ScriptedModel(), settings = store)
        val editOnly = signIn(UUID.randomUUID(), "Steve", setOf(EditorPermissions.VIEW, EditorPermissions.EDIT))
        assertEquals(403, editor("GET", AiRoutes.CONFIG_PATH, as_ = editOnly).status)
        assertEquals(403, editor("PUT", AiRoutes.CONFIG_PATH, settings("apiKey" to "sk-x"), as_ = editOnly).status)

        assertFalse(editor("GET", AiRoutes.STATUS).body!!["enabled"].asBoolean())
        assertEquals("database_unavailable", editor("PUT", AiRoutes.CONFIG_PATH, settings("apiKey" to "sk-x")).body!!["error"].asText())
        open = true
        assertTrue(editor("GET", AiRoutes.STATUS).body!!["enabled"].asBoolean(), "read once the database answers")
    }
}
