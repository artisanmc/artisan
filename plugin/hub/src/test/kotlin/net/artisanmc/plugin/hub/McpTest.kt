package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.Collections
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The MCP endpoint end to end (ADR `mcp-server`): OAuth, the tools, and deploying only when the player allowed it. */
class McpTest {
    private val mapper = ObjectMapper()
    private val sent: MutableList<Map<String, Any?>> = Collections.synchronizedList(mutableListOf())
    private val history = McpFixtures.History()
    private val modules = java.util.concurrent.ConcurrentHashMap<String, McpFixtures.Module>()
    private val server = McpFixtures.server(sent, history, modules)

    private val drafts = McpFixtures.Drafts()
    private val sessions = Sessions()
    private val grants = McpGrants()
    private val player = UUID.randomUUID()
    private val hub = HubServer(
        WebConfig(port = 0, bind = "127.0.0.1"),
        EditorApi.router(Servers(server), sessions, null, history = history, drafts = drafts, mcp = grants, version = "2.0.0"),
        sessions, EditorAssets(javaClass.classLoader), EditorChannel(null), Logger.getAnonymousLogger(),
    )
    private val client = HttpClient.newHttpClient()
    private lateinit var cookie: String
    private val base get() = "http://127.0.0.1:${hub.port}"

    @BeforeTest
    fun start() {
        sessions.onPermissions(grants::permissionsChanged)
        hub.start()
        val token = (sessions.issueLink(player, "Iban", EditorPermissions.ALL.toSet(), origin = "u-local") as Sessions.LinkResult.Issued).token
        cookie = "${HubServer.COOKIE}=" + sessions.redeem(token)!!.id
    }

    @AfterTest
    fun stop() = hub.stop()

    private class Answer(val status: Int, val body: JsonNode?, val headers: java.net.http.HttpHeaders)

    private fun http(method: String, path: String, body: String? = null, headers: Map<String, String> = emptyMap()): Answer {
        val publisher = body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody()
        val request = HttpRequest.newBuilder(URI("$base$path")).method(method, publisher).apply { headers.forEach(::header) }.build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
        return Answer(response.statusCode(), runCatching { mapper.readTree(response.body()) }.getOrNull(), response.headers())
    }

    private fun editor(method: String, path: String, body: Any? = null) =
        http(method, path, body?.let(mapper::writeValueAsString), mapOf("Cookie" to cookie, "Content-Type" to "application/json"))

    private fun form(path: String, vararg fields: Pair<String, String>) = http(
        "POST", path, fields.joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, Charsets.UTF_8)}" },
        mapOf("Content-Type" to "application/x-www-form-urlencoded"),
    )

    private var nextId = 1

    private fun rpc(token: String?, method: String, params: Any? = null, headers: Map<String, String> = emptyMap()): Answer {
        val message = mutableMapOf<String, Any?>("jsonrpc" to "2.0", "id" to nextId++, "method" to method)
        if (params != null) message["params"] = params
        val auth = token?.let { mapOf("Authorization" to "Bearer $it") }.orEmpty()
        return http("POST", McpRoutes.PATH, mapper.writeValueAsString(message), mapOf("Content-Type" to "application/json") + auth + headers)
    }

    private fun tool(token: String, name: String, vararg args: Pair<String, Any?>): JsonNode {
        val answer = rpc(token, "tools/call", mapOf("name" to name, "arguments" to args.toMap()))
        assertEquals(200, answer.status, answer.body.toString())
        return answer.body!!["result"]
    }

    private val verifier = "v".repeat(20) + UUID.randomUUID().toString().replace("-", "")
    private val redirect = "https://claude.ai/api/mcp/auth_callback"

    private fun registerClient(): String {
        val answer = http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("client_name" to "Claude", "redirect_uris" to listOf(redirect))))
        assertEquals(201, answer.status)
        return answer.body!!["client_id"].asText()
    }

    /** Register, authorize, consent, code: what a client and the player do, in that order. */
    private fun code(clientId: String = registerClient(), challenge: String = McpGrants.challenge(verifier), publish: Boolean = false): String {
        val authorize = http("GET", "${OAuthRoutes.AUTHORIZE}?response_type=code&client_id=$clientId&redirect_uri=${URLEncoder.encode(redirect, Charsets.UTF_8)}&state=xyz&code_challenge=$challenge&code_challenge_method=S256")
        assertEquals(302, authorize.status)
        val consent = authorize.headers.firstValue("Location").get()
        assertTrue(consent.startsWith(OAuthRoutes.CONSENT_PAGE + "?"), consent)
        val query = consent.substringAfter('?').split('&').associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), Charsets.UTF_8) }
        assertEquals("Claude", editor("GET", "${OAuthRoutes.CONSENT}?client_id=$clientId&redirect_uri=${URLEncoder.encode(redirect, Charsets.UTF_8)}").body!!["client"]["name"].asText())
        val approved = editor("POST", OAuthRoutes.CONSENT, query + ("approve" to true) + ("publish" to publish))
        assertEquals(200, approved.status)
        val back = approved.body!!["redirect"].asText()
        assertTrue(back.startsWith("$redirect?code="), back)
        assertTrue("state=xyz" in back)
        return back.substringAfter("code=").substringBefore('&')
    }

    private fun tokens(clientId: String = registerClient(), publish: Boolean = false): Pair<String, String> {
        val code = code(clientId, publish = publish)
        val answer = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to verifier)
        assertEquals(200, answer.status, answer.body.toString())
        assertEquals("Bearer", answer.body!!["token_type"].asText())
        return answer.body["access_token"].asText() to answer.body["refresh_token"].asText()
    }

    @Test
    fun `without a token, a client is told where to sign in`() {
        val answer = rpc(null, "initialize")
        assertEquals(401, answer.status)
        assertTrue(answer.headers.firstValue("WWW-Authenticate").get().contains("resource_metadata=\"$base${OAuthRoutes.RESOURCE_METADATA}\""))
        val resource = http("GET", OAuthRoutes.RESOURCE_METADATA).body!!
        assertEquals("$base/mcp", resource["resource"].asText())
        val metadata = http("GET", OAuthRoutes.SERVER_METADATA).body!!
        assertEquals(base, metadata["issuer"].asText())
        assertEquals(listOf("S256"), metadata["code_challenge_methods_supported"].map { it.asText() })
        assertEquals("$base${OAuthRoutes.REGISTER}", metadata["registration_endpoint"].asText())
        assertEquals(401, rpc("amcp_forged", "ping").status)
    }

    @Test
    fun `a client the player approved lists the draft tools, none of which deploys`() {
        val (access, _) = tokens()
        val init = rpc(access, "initialize", mapOf("protocolVersion" to "2025-06-18", "capabilities" to emptyMap<String, Any>(), "clientInfo" to mapOf("name" to "t", "version" to "1")))
        assertEquals("2025-06-18", init.body!!["result"]["protocolVersion"].asText())
        val notification = http("POST", McpRoutes.PATH, """{"jsonrpc":"2.0","method":"notifications/initialized"}""", mapOf("Authorization" to "Bearer $access"))
        assertEquals(202, notification.status)
        val names = rpc(access, "tools/list").body!!["result"]["tools"].map { it["name"].asText() }
        assertEquals(listOf("artisan_overview", "list_documents", "read_document", "get_kind_guide", "read_docs", "start_draft", "write_document", "read_image", "write_image", "measure_image", "render_menu", "survey_ui", "list_versions"), names)
        assertTrue(names.none { "publish" in it || "deploy" in it || "rollback" in it })
        // The kind guide is prose for the model to read, the schema outlined rather than dumped.
        val guide = tool(access, "get_kind_guide", "kind" to "menu", "project" to "u-local.shop")
        val text = guide["content"][0]["text"].asText()
        assertFalse(guide.has("structuredContent"))
        assertTrue(text.startsWith("# menu Documents\n") && "\n## Fields\n" in text && "## Example: menus/shop.yml" in text, text)
        assertTrue(text.length < 25_000, "${text.length} characters")
        // The schema knows the core's actions; the server adds its modules', each once.
        assertTrue("- guilds:rank_delete (module guilds): {rank: string}; primary: rank\n  - rank: The rank to delete." in text, text)
        assertFalse("- open_menu (module" in text || "\n- open_menu: no arguments" in text)
        assertTrue("## Texts and languages\n" in text && "title: { fr: Boutique, en: Shop }" in text)
        val full = tool(access, "get_kind_guide", "kind" to "menu", "detail" to "schema")["content"][0]["text"].asText()
        assertTrue("```json\n{\"\$schema\"" in full)
        // The docs of this release, shipped in the jar: a list, then a page without its front matter.
        val docs = tool(access, "read_docs")["content"][0]["text"].asText()
        assertTrue("- editor/expressions: Expressions — " in docs, docs)
        val page = tool(access, "read_docs", "page" to "editor/expressions")["content"][0]["text"].asText()
        assertTrue(page.startsWith("# Expressions\n\n") && "description:" !in page.substringBefore("\n## "), page.take(300))
        assertTrue(tool(access, "read_docs", "page" to "nope")["isError"].asBoolean())
        assertEquals(-32601, rpc(access, "resources/list").body!!["error"]["code"].asInt())
        assertEquals(405, http("GET", McpRoutes.PATH, headers = mapOf("Authorization" to "Bearer $access")).status)
    }

    @Test
    fun `a draft written through the MCP endpoint is checked, kept as the player's, and never published`() {
        val (access, _) = tokens()
        val overview = tool(access, "artisan_overview")["structuredContent"]
        assertEquals("u-local.shop", overview["servers"][0]["projects"][0].asText())
        val docs = tool(access, "list_documents", "project" to "u-local.shop")["structuredContent"]
        assertEquals("menus/shop.yml", docs["documents"][0]["path"].asText())
        assertEquals("menu", docs["documents"][0]["kind"].asText())
        assertTrue(docs["variants"].isNull, docs.toString())
        assertTrue("variants.yml" in overview["workflow"].toString())

        val started = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: boutique")["structuredContent"]
        val draftId = started["draft_id"].asText()
        val stored = mapper.readTree(drafts.rows.getValue(draftId))
        assertEquals("ai", stored["source"].asText())
        assertEquals(player.toString(), stored["ownerId"].asText())

        val refused = tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/vip.yml", "content" to "schema: menu/v1\nbad: 1\n")
        assertTrue(refused["isError"].asBoolean())
        assertEquals("schema", refused["structuredContent"]["problems"][0]["stage"].asText())
        assertNull(mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]["menus/vip.yml"])

        val written = tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/vip.yml", "content" to "schema: menu/v1\n")
        assertFalse(written.has("isError"), written.toString())
        assertEquals(2, written["structuredContent"]["revision"].asInt())
        val mine = tool(access, "list_documents", "project" to "u-local.shop")["structuredContent"]["your_drafts"]
        assertEquals(listOf(draftId to "AI: boutique"), mine.map { it["draft_id"].asText() to it["name"].asText() })
        val tree = mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]
        assertEquals("schema: menu/v1\n", tree["menus/vip.yml"].asText())
        assertEquals("a: b\n", tree["lang/en.yml"].asText())
        val read = tool(access, "read_document", "project" to "u-local.shop", "path" to "menus/vip.yml", "draft_id" to draftId)
        assertEquals("schema: menu/v1\n", read["structuredContent"]["content"].asText())

        // The check sees the draft's changes against what the server runs, not the file alone.
        val check = sent.last { it["type"] == "documents_check" }
        assertEquals("shop", check["project_id"])
        assertEquals("active", mapper.readTree(drafts.rows.getValue(draftId))["status"].asText())
        assertTrue(sent.none { it["type"] == "project_write" || it["type"] == "project_draft_publish" })
    }

    @Test
    fun `a menu is rendered as a picture, from a draft with the images it holds or as deployed`() {
        val (access, _) = tokens()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: render")["structuredContent"]["draft_id"].asText()
        val green = mapOf("palette" to mapOf("g" to "#20c040"), "rows" to List(18) { "g".repeat(54) })
        assertFalse(tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to "buy_button", "pixels" to green).has("isError"))
        val menu = "schema: menu/v1\nsize: 27\ntitle: Shop\nelements:\n  - id: buy\n    positions: \"12-14\"\n    image: { asset: buy_button }\n  - id: gem\n    positions: \"0\"\n    material: DIAMOND\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/vip.yml", "content" to menu).has("isError"))

        val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/vip.yml", "draft_id" to draftId)
        assertFalse(rendered.has("isError"), rendered.toString())
        val facts = rendered["structuredContent"]
        assertEquals("x3", facts["shown_at"].asText())
        val window = facts["window"]
        assertEquals(listOf(176, 113 + 3 * 18), listOf(window["width"].asInt(), window["height"].asInt()))
        assertTrue(facts["notes"].any { "every item shows" in it.asText() }, "no item pictures in this hub: said, not hidden")
        val picture = rendered["content"][1]
        assertEquals("image" to "image/png", picture["type"].asText() to picture["mimeType"].asText())
        val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(picture["data"].asText()))
        // The button over slots 12 to 14 (second row, columns 3 to 5), three picture pixels a game pixel.
        val at = ((window["y"].asInt() + 17 + 18 + 9) * 3 * shown.width + (window["x"].asInt() + 7 + 4 * 18) * 3) * 4
        assertEquals(listOf(0x20, 0xc0, 0x40), shown.data.slice(at until at + 3).map { it.toInt() and 0xff })

        // As deployed, without the draft: the menu the server has. Another file is not a menu.
        val deployed = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/shop.yml", "scale" to 1)
        assertEquals("x1", deployed["structuredContent"]["shown_at"].asText())
        assertTrue(tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/vip.yml")["isError"].asBoolean(), "not deployed yet")
        assertTrue(tool(access, "render_menu", "project" to "u-local.shop", "path" to "lang/en.yml")["isError"].asBoolean())
    }

    @Test
    fun `a server's images are surveyed module by module, with its kit, and a menu draws the kit's image`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/shop_icon.png" to solid(16, 16, 0x3366cc)))
        modules["ui-kit"] = McpFixtures.Module(
            files = mapOf("data/ui-kit.yml" to "notes: Vanilla bevel, no black outline.\n", "menus/demo.yml" to "schema: menu/v1\nsize: 9\nelements:\n  - positions: \"0\"\n    image: { asset: kit_button }\n"),
            images = mapOf(
                "assets/textures/kit_button.png" to solid(54, 18, 0x20c040), "originals/assets/textures/kit_button.png" to solid(54, 18, 0x000000),
                "assets/glyphs/kit_window.png" to solid(176, 166, 0xc6c6c6),
            ),
        )
        val (access, _) = tokens()

        val survey = tool(access, "survey_ui", "server" to "u-local")
        assertFalse(survey.has("isError"), survey.toString())
        val facts = survey["structuredContent"]
        assertEquals(listOf("u-local.shop", "u-local.ui-kit"), facts["modules"].map { it["project"].asText() })
        // The kit's own button, not the one it shipped with; numbered across the modules.
        val kitImages = facts["modules"][1]["images"]
        assertEquals(listOf("kit_window" to "background", "kit_button" to "button"), kitImages.map { it["name"].asText() to it["use"].asText() })
        assertEquals(listOf(2, 3), kitImages.map { it["n"].asInt() })
        assertEquals(listOf("menus/demo.yml"), facts["modules"][1]["menus_with_images"].map { it.asText() })
        assertEquals("#c6c6c6", facts["colours"][0]["colour"].asText(), "the colour most pixels have")
        assertTrue("Vanilla bevel" in facts["kit"]["content"].asText())
        assertEquals("u-local.ui-kit", facts["kit"]["project"].asText())
        assertEquals(listOf("text", "image", "image", "image"), survey["content"].map { it["type"].asText() }, "one sheet per module, one for the base")

        // A menu of the shop that names the kit's button draws it: an image is found on the whole server.
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: kit")["structuredContent"]["draft_id"].asText()
        val menu = "schema: menu/v1\nsize: 9\nvanilla_texture: false\nelements:\n  - positions: \"0-2\"\n    image: { asset: kit_button }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/kit.yml", "content" to menu).has("isError"))
        val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/kit.yml", "draft_id" to draftId, "scale" to 1)
        assertTrue(rendered["structuredContent"]["notes"].none { "kit_button" in it.asText() }, rendered["structuredContent"].toString())
        val window = rendered["structuredContent"]["window"]
        val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
        val at = ((window["y"].asInt() + 17 + 9) * shown.width + window["x"].asInt() + 7 + 27) * 4
        assertEquals(listOf(0x20, 0xc0, 0x40), shown.data.slice(at until at + 3).map { it.toInt() and 0xff })

        // A server without a kit is told how one is made.
        modules.remove("ui-kit")
        assertTrue("create_module" in tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["kit"]["how"].asText())
        assertTrue(tool(access, "survey_ui", "server" to "nowhere")["isError"].asBoolean())
    }

    @Test
    fun `the kit's base is on every server under kit names, and the kit module's image of the same size replaces one`() {
        fun solid(width: Int, height: Int, rgb: Int) = net.artisanmc.plugin.pack.RgbaImage(width, height).also { image ->
            for (i in 0 until width * height) java.nio.ByteBuffer.wrap(image.data, i * 4, 4).putInt((rgb shl 8) or 0xff)
        }.let(net.artisanmc.plugin.pack.Png::encode)
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/shop_icon.png" to solid(16, 16, 0x3366cc)))
        val (access, _) = tokens()

        // A server without a kit module has the base as Artisan ships it, numbered after its own images.
        val base = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["kit_base"]
        assertEquals(net.artisanmc.plugin.pack.Kit.slots.map { "kit:${it.id}" }, base["images"].map { it["image"].asText() })
        assertEquals((2..20).toList(), base["images"].map { it["n"].asInt() })
        assertEquals(setOf("artisan"), base["images"].map { it["drawn_by"].asText() }.toSet())
        assertEquals(54 to 18, base["images"][3].let { it["width"].asInt() to it["height"].asInt() })

        // A menu draws a base image as an element's and as its window.
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: base")["structuredContent"]["draft_id"].asText()
        val menu = "schema: menu/v1\nsize: 27\nvanilla_texture: false\ntitle:\n  - { kind: background, asset: \"kit:window.3\" }\n" +
            "elements:\n  - positions: \"0-2\"\n    image: { asset: \"kit:button.3x1\", fit: native }\n"
        assertFalse(tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/base.yml", "content" to menu).has("isError"))
        fun pixels(): Pair<List<Int>, List<Int>> {
            val rendered = tool(access, "render_menu", "project" to "u-local.shop", "path" to "menus/base.yml", "draft_id" to draftId, "scale" to 1)
            assertTrue(rendered["structuredContent"]["notes"].none { "kit:" in it.asText() }, rendered["structuredContent"].toString())
            val window = rendered["structuredContent"]["window"]
            val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(rendered["content"][1]["data"].asText()))
            fun at(x: Int, y: Int) = ((window["y"].asInt() + y) * shown.width + window["x"].asInt() + x) * 4
            fun rgb(at: Int) = shown.data.slice(at until at + 3).map { it.toInt() and 0xff }
            // The middle of the button over the first three slots; the window's corner pixel that is not empty.
            return rgb(at(7 + 27, 17 + 9)) to rgb(at(3, 3))
        }
        fun shipped(id: String, x: Int, y: Int): List<Int> {
            val image = net.artisanmc.plugin.pack.Png.decode(net.artisanmc.plugin.pack.Kit.shipped(net.artisanmc.plugin.pack.Kit.slot(id)!!))
            return image.data.slice((y * image.width + x) * 4 until (y * image.width + x) * 4 + 3).map { it.toInt() and 0xff }
        }
        assertEquals(shipped("button.3x1", 27, 9) to shipped("window.3", 3, 3), pixels())

        // The kit module restyles a slot with an image of its name and size; another size or another module is refused.
        modules["ui-kit"] = McpFixtures.Module()
        val kitDraft = tool(access, "start_draft", "project" to "u-local.ui-kit", "name" to "AI: kit")["structuredContent"]["draft_id"].asText()
        fun png(width: Int, height: Int) = java.util.Base64.getEncoder().encodeToString(solid(width, height, 0xcc2020))
        val small = tool(access, "write_image", "project" to "u-local.ui-kit", "draft_id" to kitDraft, "name" to "button.3x1", "png_base64" to png(20, 10))
        assertTrue(small["isError"].asBoolean() && "54x18" in small["structuredContent"]["message"].asText(), small.toString())
        val written = tool(access, "write_image", "project" to "u-local.ui-kit", "draft_id" to kitDraft, "name" to "button.3x1", "use" to "background", "png_base64" to png(54, 18))
        assertFalse(written.has("isError"), written.toString())
        assertEquals("assets/textures/button.3x1.png", written["structuredContent"]["path"].asText())
        assertTrue("kit:button.3x1" in written["structuredContent"]["use_it"].asText())
        assertTrue(tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to "button.3x1", "png_base64" to png(54, 18))["isError"].asBoolean())
        val other = tool(access, "write_image", "project" to "u-local.ui-kit", "draft_id" to kitDraft, "name" to "banner", "png_base64" to png(20, 10))
        assertTrue("kit:banner" in other["structuredContent"]["use_it"].asText(), other.toString())

        // Deployed, the server's image is what every menu naming the slot shows; one of another size is left out.
        modules["ui-kit"] = McpFixtures.Module(
            images = mapOf("assets/textures/button.3x1.png" to solid(54, 18, 0xcc2020), "assets/textures/window.3.png" to solid(20, 20, 0x00ff00)),
        )
        assertEquals(listOf(0xcc, 0x20, 0x20) to shipped("window.3", 3, 3), pixels())
        val restyled = tool(access, "survey_ui", "server" to "u-local")["structuredContent"]["kit_base"]["images"].associateBy { it["image"].asText() }
        assertEquals("this server", restyled.getValue("kit:button.3x1")["drawn_by"].asText())
        assertEquals("artisan", restyled.getValue("kit:window.3")["drawn_by"].asText())
        assertTrue(restyled.getValue("kit:window.3").has("ignored"))
        assertFalse(restyled.getValue("kit:cell").has("ignored"))
    }

    @Test
    fun `an image is cut out of a picture, at the art's own size and without its ground`() {
        // A round button drawn four times its size on a plain ground, as a screenshot or a sprite sheet shows it.
        val rows = listOf("_kkkkkk_", "kwwwwwgk", "kwrrrrgk", "kwrbbrgk", "kgggggGk", "_kkkkkk_")
        val colours = mapOf('_' to 0x3a2852, 'k' to 0x000000, 'w' to 0xffffff, 'r' to 0xc03030, 'b' to 0x3050c0, 'g' to 0x8b8b8b, 'G' to 0x555555)
        val sheet = net.artisanmc.plugin.pack.RgbaImage(120, 90)
        for (y in 0 until 90) for (x in 0 until 120) {
            val key = rows.getOrNull(Math.floorDiv(y - 19, 4))?.getOrNull(Math.floorDiv(x - 23, 4)) ?: '_'
            java.nio.ByteBuffer.wrap(sheet.data, (y * 120 + x) * 4, 4).putInt((colours.getValue(key) shl 8) or 0xff)
        }
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/sheet.png" to net.artisanmc.plugin.pack.Png.encode(sheet)))
        val (access, _) = tokens()

        val measured = tool(access, "measure_image", "project" to "u-local.shop", "path" to "assets/textures/sheet.png")
        assertFalse(measured.has("isError"), measured.toString())
        val facts = measured["structuredContent"]
        assertEquals(listOf(120, 90, 4), listOf("width", "height", "pixel_size").map { facts[it].asInt() })
        assertEquals("x8" to "#3a2852", facts["shown_at"].asText() to facts["background"].asText())
        assertEquals("""[{"n":1,"x":23,"y":19,"width":32,"height":24,"art_size":"8x6"}]""", facts["elements"].toString())
        assertEquals("image" to "image/png", measured["content"][1]["type"].asText() to measured["content"][1]["mimeType"].asText())
        // A zone holds what is asked of the picture, and one outside it is refused.
        val zone = mapOf("x" to 10, "y" to 10, "width" to 60, "height" to 40)
        assertEquals("x12", tool(access, "measure_image", "project" to "u-local.shop", "path" to "assets/textures/sheet.png", "zone" to zone)["structuredContent"]["shown_at"].asText())
        assertTrue(tool(access, "measure_image", "project" to "u-local.shop", "path" to "assets/textures/sheet.png", "zone" to zone + ("x" to 500))["isError"].asBoolean())

        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: cut")["structuredContent"]["draft_id"].asText()
        fun cut(name: String, vararg from: Pair<String, Any?>) =
            tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to name, "from" to mapOf("path" to "assets/textures/sheet.png", *from))
        fun stored(name: String): net.artisanmc.plugin.pack.RgbaImage {
            val ref = mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["binaryTree"]["assets/textures/$name.png"]
            return net.artisanmc.plugin.pack.Png.decode(drafts.blobs.getValue(ref["hash"].asText()))
        }
        fun pixel(image: net.artisanmc.plugin.pack.RgbaImage, x: Int, y: Int) = java.nio.ByteBuffer.wrap(image.data, (y * image.width + x) * 4, 4).int

        // A loose rectangle around the button: its ground goes, the image is the button alone, one pixel per art pixel.
        val round = cut("round_button", "x" to 18, "y" to 15, "width" to 44, "height" to 33, "background" to "remove")
        assertFalse(round.has("isError"), round.toString())
        val cutFacts = round["structuredContent"]
        assertEquals(listOf(8, 6, 4), listOf("width", "height", "pixel_size").map { cutFacts[it].asInt() })
        assertEquals("#3a2852", cutFacts["background_removed"].asText())
        assertEquals("""{"picture":"assets/textures/sheet.png","x":23,"y":19,"width":32,"height":24}""", cutFacts["cut_from"].toString())
        val button = stored("round_button")
        assertEquals(listOf(0, 0x000000ff, 0xffffffff.toInt(), 0x3050c0ff), listOf(pixel(button, 0, 0), pixel(button, 1, 0), pixel(button, 1, 1), pixel(button, 3, 3)))
        assertEquals("width: 8\nheight: 6\nusages: [button]\n", mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["tree"]["assets/textures/round_button.yml"].asText())

        // Kept as it is: a rectangle a pixel or two off snaps to the art's pixels, and the corners keep the ground.
        assertEquals(0x3a2852ff, pixel(cut("square_button", "x" to 24, "y" to 18, "width" to 31, "height" to 25).let { stored("square_button") }, 0, 0))
        // A pixel size given wins over the one found; fewer colours when asked.
        val coarse = cut("coarse", "x" to 23, "y" to 19, "width" to 32, "height" to 24, "pixel_size" to 8, "colours" to 2)["structuredContent"]
        assertEquals(listOf(4, 3, 2), listOf("width", "height", "colours_kept").map { coarse[it].asInt() })

        // What cannot be cut says why: no attachment outside the assistant, a rectangle off the picture, only ground.
        val none = cut("x", "attachment" to "capture.png")
        assertTrue(none["isError"].asBoolean() && "editor's assistant" in none["structuredContent"]["message"].asText(), none.toString())
        assertTrue(cut("x", "x" to 200, "y" to 0, "width" to 10, "height" to 10)["isError"].asBoolean())
        assertTrue("Nothing is left" in cut("x", "x" to 80, "y" to 60, "width" to 20, "height" to 20, "background" to "remove")["structuredContent"]["message"].asText())
        assertTrue(tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to "x", "from" to mapOf("x" to 1))["isError"].asBoolean())
    }

    @Test
    fun `icons are cut out of an inventory's slots, in a picture resized by a fraction`() {
        // Three slots as the game draws them (dark edge top and left, light edge bottom and right) in a panel, a gem in the
        // first and a block that fills the second, the whole resized by 4.5 and smoothed: a store's preview, a mock-up.
        val gem = listOf("__kkkkkkkk__", "_kwwwwwwwwk_", "kwwbbbbbbwwk", "kwbbwbbbbbwk", "kwbwbbbbbbwk", "_kwbbbbbbwk_", "__kwbbbbwk__", "___kwbbwk___", "____kwwk____", "_____kk_____")
        val colours = mapOf('_' to 0x8b8b8b, 'k' to 0x000000, 'w' to 0xffffff, 'r' to 0xc03030, 'b' to 0x3050c0, 'p' to 0xc6c6c6, 'd' to 0x373737)
        fun art(x: Int, y: Int): Char {
            val column = Math.floorDiv(x - 1, 18)
            val i = Math.floorMod(x - 1, 18)
            val j = y - 1
            if (column !in 0..2 || j !in 0..17) return 'p'
            return when {
                (j == 0 && i < 17) || (i == 0 && j < 17) -> 'd'
                (j == 17 && i > 0) || (i == 17 && j > 0) -> 'w'
                i == 0 || i == 17 -> '_'
                column == 0 -> gem.getOrNull(j - 4)?.getOrNull(i - 3) ?: '_'
                column == 2 -> '_'
                else -> if (((i - 1) / 4 + (j - 1) / 4) % 2 == 0) 'r' else 'b'
            }
        }
        val scale = 4.5
        val picture = net.artisanmc.plugin.pack.RgbaImage((56 * scale).toInt(), (20 * scale).toInt())
        for (y in 0 until picture.height) for (x in 0 until picture.width) {
            val sum = IntArray(3)
            for (j in 0 until 4) for (i in 0 until 4) {
                val colour = colours.getValue(art(((x + (i + 0.5) / 4) / scale).toInt(), ((y + (j + 0.5) / 4) / scale).toInt()))
                sum[0] += colour shr 16
                sum[1] += (colour shr 8) and 0xff
                sum[2] += colour and 0xff
            }
            java.nio.ByteBuffer.wrap(picture.data, (y * picture.width + x) * 4, 4).putInt(((sum[0] / 16) shl 24) or ((sum[1] / 16) shl 16) or ((sum[2] / 16) shl 8) or 0xff)
        }
        modules["shop"] = McpFixtures.Module(images = mapOf("assets/textures/preview.png" to net.artisanmc.plugin.pack.Png.encode(picture)))
        val (access, _) = tokens()

        val facts = tool(access, "measure_image", "project" to "u-local.shop", "path" to "assets/textures/preview.png")["structuredContent"]
        assertEquals(4.5, facts["pixel_size"].asDouble(), 0.02)
        assertTrue("resized" in facts["pixel_size_note"].asText())
        assertEquals("#8b8b8b", facts["background"].asText())
        // The slots' lines part the icons and are no element; the block touches them and still comes alone.
        assertEquals(listOf("12x10", "16x16"), facts["elements"].map { it["art_size"].asText() })
        assertTrue("background: \"#8b8b8b\"" in facts["next"].asText(), facts["next"].asText())

        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: icons")["structuredContent"]["draft_id"].asText()
        fun cut(name: String, element: JsonNode, vararg more: Pair<String, Any?>) = tool(
            access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, "name" to name,
            "from" to mapOf("path" to "assets/textures/preview.png", "x" to element["x"].asInt(), "y" to element["y"].asInt(), "width" to element["width"].asInt(), "height" to element["height"].asInt(), *more),
        )
        fun stored(name: String): net.artisanmc.plugin.pack.RgbaImage {
            val ref = mapper.readTree(drafts.rows.getValue(draftId))["snapshot"]["binaryTree"]["assets/textures/$name.png"]
            return net.artisanmc.plugin.pack.Png.decode(drafts.blobs.getValue(ref["hash"].asText()))
        }
        fun pixel(image: net.artisanmc.plugin.pack.RgbaImage, x: Int, y: Int) = java.nio.ByteBuffer.wrap(image.data, (y * image.width + x) * 4, 4).int

        // The element's own rectangle has no ground around it: the ground is named, and goes from the rectangle's edge inward.
        val written = cut("gem", facts["elements"][0], "background" to "#8b8b8b", "colours" to 4)
        assertFalse(written.has("isError"), written.toString())
        val cutFacts = written["structuredContent"]
        assertEquals(listOf(12, 10), listOf("width", "height").map { cutFacts[it].asInt() })
        assertEquals(4.5, cutFacts["pixel_size"].asDouble(), 0.02)
        assertEquals("#8b8b8b", cutFacts["background_removed"].asText())
        assertTrue(cutFacts["notes"].any { "resized" in it.asText() }, cutFacts.toString())
        val image = stored("gem")
        // A corner is transparent, the outline black, the gem's inside blue, as drawn.
        assertEquals(listOf(0, 0x000000ff, 0x3050c0ff), listOf(pixel(image, 0, 0), pixel(image, 2, 0), pixel(image, 5, 4)))

        // A ground the rectangle's edge does not show is said, not guessed; anything else than a colour or a mode is refused.
        val wrong = cut("block", facts["elements"][1], "background" to "#00ff00")["structuredContent"]
        assertEquals(listOf(16, 16), listOf("width", "height").map { wrong[it].asInt() })
        assertTrue(!wrong.has("background_removed") && wrong["notes"].any { "Nothing was removed" in it.asText() }, wrong.toString())
        assertTrue(cut("x", facts["elements"][0], "background" to "green")["isError"].asBoolean())
        // The size given by hand is laid on the art's own cells: the same image.
        cut("gem_by_hand", facts["elements"][0], "background" to "#8b8b8b", "colours" to 4, "pixel_size" to 4.5)
        assertContentEquals(image.data, stored("gem_by_hand").data)
    }

    @Test
    fun `an image written as pixels enters the draft with its descriptor, and comes back enlarged for the model to see`() {
        val (access, _) = tokens()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: images")["structuredContent"]["draft_id"].asText()
        fun write(vararg args: Pair<String, Any?>) = tool(access, "write_image", "project" to "u-local.shop", "draft_id" to draftId, *args)
        val pixels = mapOf("palette" to mapOf("#" to "#373737", "w" to "#ffffff", "s" to "#00000080"), "rows" to listOf("####", "#ww#", "#.s#", "####"))

        val written = write("name" to "shop_button", "pixels" to pixels)
        assertFalse(written.has("isError"), written.toString())
        val facts = written["structuredContent"]
        assertEquals("assets/textures/shop_button.png", facts["path"].asText())
        assertEquals(listOf(4, 4, 3, 1), listOf("width", "height", "colours", "translucent_pixels").map { facts[it].asInt() })
        // The picture the model looks at: a PNG, each pixel a square.
        val picture = written["content"][1]
        assertEquals("image" to "image/png", picture["type"].asText() to picture["mimeType"].asText())
        val shown = net.artisanmc.plugin.pack.Png.decode(java.util.Base64.getDecoder().decode(picture["data"].asText()))
        assertEquals(4 * 16, shown.width)
        val snapshot = { mapper.readTree(drafts.rows.getValue(draftId))["snapshot"] }
        val ref = snapshot()["binaryTree"]["assets/textures/shop_button.png"]
        assertEquals("width: 4\nheight: 4\nusages: [button]\n", snapshot()["tree"]["assets/textures/shop_button.yml"].asText())
        val stored = net.artisanmc.plugin.pack.Png.decode(drafts.blobs.getValue(ref["hash"].asText()))
        assertEquals(listOf(0x37, 0x37, 0x37, 0xff), stored.data.take(4).map { it.toInt() and 0xff })
        assertEquals(0, stored.alpha(1, 2))
        assertEquals(0x80, stored.alpha(2, 2))

        // Read back from the draft: the same pixels as text, to change and write again.
        val read = tool(access, "read_image", "project" to "u-local.shop", "path" to "assets/textures/shop_button.png", "draft_id" to draftId)
        assertEquals(listOf("####", "#aa#", "#.b#", "####"), read["structuredContent"]["pixels"]["rows"].map { it.asText() })
        assertEquals("#00000080", read["structuredContent"]["pixels"]["palette"]["b"].asText())
        assertEquals(listOf("assets/textures/shop_button.png"), tool(access, "list_documents", "project" to "u-local.shop", "draft_id" to draftId)["structuredContent"]["images"].map { it.asText() })
        assertTrue(tool(access, "read_image", "project" to "u-local.shop", "path" to "assets/textures/shop_button.png")["isError"].asBoolean())

        // A window background is a title image: a codepoint no other image of the draft has, kept when it is written over.
        val png = java.util.Base64.getEncoder().encodeToString(net.artisanmc.plugin.pack.Png.encode(net.artisanmc.plugin.pack.RgbaImage(176, 166)))
        assertFalse(write("name" to "shop_window", "use" to "background", "png_base64" to png).has("isError"))
        assertFalse(write("name" to "vip_window", "use" to "background", "png_base64" to png).has("isError"))
        assertEquals("ascent: 13\ncodepoint: 57344\nwidth: 176\nheight: 166\nusages: [menu]\n", snapshot()["tree"]["assets/glyphs/shop_window.yml"].asText())
        assertTrue("codepoint: 57345\n" in snapshot()["tree"]["assets/glyphs/vip_window.yml"].asText())
        val again = write("name" to "shop_window", "pixels" to pixels)
        assertTrue(again["structuredContent"]["replaced"].asBoolean())
        assertEquals("ascent: 13\ncodepoint: 57344\nusages: [menu]\nwidth: 4\nheight: 4\n", snapshot()["tree"]["assets/glyphs/shop_window.yml"].asText())

        // What cannot be an image is refused with what to fix, and the draft does not move.
        val revision = mapper.readTree(drafts.rows.getValue(draftId))["revision"].asInt()
        val ragged = write("name" to "bad", "pixels" to mapOf("palette" to mapOf("#" to "#000000"), "rows" to listOf("##", "#")))
        assertTrue(ragged["isError"].asBoolean() && "row 2" in ragged["structuredContent"]["message"].asText(), ragged.toString())
        assertTrue(write("name" to "bad", "pixels" to mapOf("palette" to mapOf("#" to "red"), "rows" to listOf("#")))["isError"].asBoolean())
        assertTrue(write("name" to "bad", "pixels" to mapOf("palette" to emptyMap<String, String>(), "rows" to listOf("?")))["isError"].asBoolean())
        assertTrue(write("name" to "Bad Name", "pixels" to pixels)["isError"].asBoolean())
        assertTrue(write("name" to "bad", "png_base64" to "bm90IGEgcG5nIGZpbGUsIGp1c3QgdGV4dCB0aGF0IGlzIGxvbmc=")["isError"].asBoolean())
        val huge = net.artisanmc.plugin.pack.Png.encode(net.artisanmc.plugin.pack.RgbaImage(1, 1)).also { java.nio.ByteBuffer.wrap(it).putInt(16, 100_000) }
        assertTrue(write("name" to "bad", "png_base64" to java.util.Base64.getEncoder().encodeToString(huge))["isError"].asBoolean())
        assertEquals(revision, mapper.readTree(drafts.rows.getValue(draftId))["revision"].asInt())

        assertTrue(write("name" to "vip_window", "delete" to true)["structuredContent"]["deleted"].asBoolean())
        assertNull(snapshot()["binaryTree"]["assets/glyphs/vip_window.png"])
        assertNull(snapshot()["tree"]["assets/glyphs/vip_window.yml"])
        assertTrue(sent.none { it["type"] == "project_write" || it["type"] == "project_draft_publish" })
    }

    @Test
    fun `the MCP endpoint writes to a server's disk only through a publication, for a principal that may deploy`() {
        assertEquals(setOf("list", "read", "create", "update", "write_blob", "publish"), McpProjects.DRAFT_ACTIONS)
        val projects = McpProjects(Servers(server), null, drafts)
        val shop = ProjectRef(server, "shop")
        assertFailsWith<IllegalArgumentException> { projects.draft(McpPrincipal(player, "Iban", EditorPermissions.ALL.toSet()), shop, "discard") }
        val draftOnly = McpPrincipal(player, "Iban", EditorPermissions.ALL.toSet() - EditorPermissions.PUBLISH)
        assertEquals("forbidden", assertFailsWith<McpRefusal> { projects.draft(draftOnly, shop, "publish") }.code)
        // No MCP or assistant source names a message that writes to a server's disk: a publication is built by the drafts.
        val dir = listOf("src/main/kotlin/net/artisanmc/plugin/hub", "hub/src/main/kotlin/net/artisanmc/plugin/hub").map(::File).first { it.isDirectory }
        val sources = dir.listFiles { f -> f.name.startsWith("Mcp") || f.name.startsWith("Ai") || f.name.startsWith("Anthropic") }!!
        assertTrue(sources.size >= 8)
        for (file in sources) {
            val text = file.readText()
            for (forbidden in listOf("project_write", "project_draft_publish", "template_copy", "project_delete", "project_rename")) {
                assertFalse(forbidden in text, "${file.name} names $forbidden")
            }
        }
    }

    @Test
    fun `revoking a client cuts it off on its next call`() {
        val (access, _) = tokens()
        assertEquals(200, rpc(access, "ping").status)
        val listed = editor("GET", OAuthRoutes.GRANTS).body!!["grants"]
        assertEquals("Claude", listed[0]["client"].asText())
        assertEquals(200, editor("DELETE", "${OAuthRoutes.GRANTS}/${listed[0]["id"].asText()}").status)
        assertEquals(401, rpc(access, "ping").status)
    }

    @Test
    fun `losing artisan editor edit cuts access, losing view ends the grant`() {
        val (access, _) = tokens()
        sessions.refresh("u-local", mapOf(player to setOf(EditorPermissions.VIEW)))
        val answer = rpc(access, "ping")
        assertEquals(403, answer.status)
        assertTrue(answer.headers.firstValue("WWW-Authenticate").get().contains("insufficient_scope"))
        sessions.refresh("u-local", mapOf(player to setOf(EditorPermissions.VIEW, EditorPermissions.EDIT, EditorPermissions.PUBLISH)))
        assertEquals(200, rpc(access, "ping").status)
        assertFalse(grants.grants(player).single().can(EditorPermissions.PUBLISH), "an MCP client is draft only by default")
        sessions.refresh("u-local", mapOf(player to emptySet()))
        assertEquals(401, rpc(access, "ping").status)
        assertTrue(grants.grants(player).isEmpty())
    }

    @Test
    fun `a code needs its verifier, works once, and a refresh token rotates`() {
        val clientId = registerClient()
        val code = code(clientId)
        val wrong = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to "w".repeat(43))
        assertEquals("invalid_grant", wrong.body!!["error"].asText())
        // A wrong verifier burns the code.
        val retry = form(OAuthRoutes.TOKEN, "grant_type" to "authorization_code", "code" to code, "client_id" to clientId, "redirect_uri" to redirect, "code_verifier" to verifier)
        assertEquals("invalid_grant", retry.body!!["error"].asText())

        val (access, refresh) = tokens(clientId)
        val rotated = form(OAuthRoutes.TOKEN, "grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to clientId)
        assertEquals(200, rotated.status)
        assertEquals(401, rpc(access, "ping").status)
        assertEquals(200, rpc(rotated.body!!["access_token"].asText(), "ping").status)
        assertEquals("invalid_grant", form(OAuthRoutes.TOKEN, "grant_type" to "refresh_token", "refresh_token" to refresh, "client_id" to clientId).body!!["error"].asText())
    }

    @Test
    fun `an app the player allowed shows the diff, deploys the reviewed revision as theirs via the app, and rolls back`() {
        val (access, _) = tokens(publish = true)
        val names = rpc(access, "tools/list").body!!["result"]["tools"]
        val publish = names.first { it["name"].asText() == "draft_publish" }
        assertTrue(publish["annotations"]["destructiveHint"].asBoolean())
        assertTrue(names.any { it["name"].asText() == "version_rollback" })
        assertTrue(tool(access, "artisan_overview")["structuredContent"]["can_deploy"].asBoolean())

        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI: vip")["structuredContent"]["draft_id"].asText()
        tool(access, "write_document", "project" to "u-local.shop", "draft_id" to draftId, "path" to "menus/shop.yml", "content" to "schema: menu/v1\ntitle: Shop\n")
        // A stale revision deploys nothing.
        val stale = tool(access, "draft_publish", "project" to "u-local.shop", "draft_id" to draftId, "expected_revision" to 1)
        assertEquals("draft_conflict", stale["structuredContent"]["error"].asText())
        val preview = tool(access, "draft_publish", "project" to "u-local.shop", "draft_id" to draftId, "expected_revision" to 2, "dry_run" to true)["structuredContent"]
        assertFalse(preview["deployed"].asBoolean())
        assertEquals("@@ -1,1 +1,2 @@\n schema: menu/v1\n+title: Shop\n", preview["changes"][0]["diff"].asText())
        assertTrue(sent.none { it["type"] == "project_draft_publish" }, "a dry run deploys nothing")

        val deployed = tool(access, "draft_publish", "project" to "u-local.shop", "draft_id" to draftId, "expected_revision" to 2)
        assertFalse(deployed.has("isError"), deployed.toString())
        val result = deployed["structuredContent"]
        assertEquals("2", result["version"].asText())
        assertEquals("1", result["previous_version"].asText())
        assertEquals("Iban via Claude", result["published_by"].asText())
        assertEquals("modified", result["changes"][0]["change"].asText())
        val publication = sent.single { it["type"] == "project_draft_publish" }
        assertEquals("Claude", publication["author_via"])
        assertEquals("Iban", publication["author_name"])
        assertEquals("published", mapper.readTree(drafts.rows.getValue(draftId))["status"].asText())
        val versions = tool(access, "list_versions", "project" to "u-local.shop")["structuredContent"]["versions"]
        assertEquals("Iban via Claude", versions[0]["published_by"].asText())

        // Rolling back needs the newest Version the player saw: another deploy since refuses it.
        val raced = tool(access, "version_rollback", "project" to "u-local.shop", "version" to "1", "expected_version" to "1")
        assertEquals("version_conflict", raced["structuredContent"]["error"].asText())
        val rolled = tool(access, "version_rollback", "project" to "u-local.shop", "version" to "1", "expected_version" to "2")["structuredContent"]
        assertEquals("3", rolled["version"].asText())
        assertEquals("1", rolled["restored_from"].asText())
        assertEquals("@@ -1,2 +1,1 @@\n schema: menu/v1\n-title: Shop\n", rolled["changes"].first { it["path"].asText() == "menus/shop.yml" }["diff"].asText())
        assertEquals("schema: menu/v1\n", history.versions.last().files["menus/shop.yml"])
        assertEquals("1", history.versions.last().restoredFrom)
    }

    @Test
    fun `an app the player allowed creates an empty module, and only one with a valid new name`() {
        val (draftOnly, _) = tokens()
        assertFalse(rpc(draftOnly, "tools/list").body!!["result"]["tools"].any { it["name"].asText() == "create_module" })
        assertFalse(tool(draftOnly, "artisan_overview")["structuredContent"]["can_create_modules"].asBoolean())

        val (access, _) = tokens(publish = true)
        val create = rpc(access, "tools/list").body!!["result"]["tools"].first { it["name"].asText() == "create_module" }
        assertFalse(create["annotations"]["destructiveHint"].asBoolean())
        val created = tool(access, "create_module", "server" to "u-local", "name" to "ia")["structuredContent"]
        assertEquals("u-local.ia", created["project"].asText())
        assertEquals("ia", sent.single { it["type"] == "project_create" }["project_id"])
        assertEquals("project_exists", tool(access, "create_module", "server" to "u-local", "name" to "shop")["structuredContent"]["error"].asText())
        assertEquals("invalid_name", tool(access, "create_module", "server" to "u-local", "name" to "../x")["structuredContent"]["error"].asText())
        assertEquals("unknown_server", tool(access, "create_module", "server" to "nope", "name" to "x")["structuredContent"]["error"].asText())
        assertEquals(2, sent.count { it["type"] == "project_create" })
    }

    @Test
    fun `an app is draft only unless the player allows it, and allowing takes the player's own publish`() {
        val (access, _) = tokens()
        val draftId = tool(access, "start_draft", "project" to "u-local.shop", "name" to "AI")["structuredContent"]["draft_id"].asText()
        // Not offered, and refused when called anyway.
        val refused = tool(access, "draft_publish", "project" to "u-local.shop", "draft_id" to draftId, "expected_revision" to 1)
        assertEquals("forbidden", refused["structuredContent"]["error"].asText())
        assertFalse(tool(access, "artisan_overview")["structuredContent"]["can_deploy"].asBoolean())

        val listed = editor("GET", OAuthRoutes.GRANTS).body!!
        assertTrue(listed["canPublish"].asBoolean())
        assertFalse(listed["grants"][0]["publish"].asBoolean())
        val grant = listed["grants"][0]["id"].asText()
        assertEquals(200, editor("PATCH", "${OAuthRoutes.GRANTS}/$grant", mapOf("publish" to true)).status)
        assertTrue(rpc(access, "tools/list").body!!["result"]["tools"].any { it["name"].asText() == "draft_publish" })
        assertEquals(404, editor("PATCH", "${OAuthRoutes.GRANTS}/nope", mapOf("publish" to true)).status)

        // A player who cannot deploy cannot let an app deploy, and an app allowed before loses it with them.
        sessions.refresh("u-local", mapOf(player to setOf(EditorPermissions.VIEW, EditorPermissions.EDIT)))
        assertFalse(rpc(access, "tools/list").body!!["result"]["tools"].any { it["name"].asText() == "draft_publish" })
        // The editor session follows the same report: the player's own consent page no longer offers deploying.
        assertEquals(403, editor("PATCH", "${OAuthRoutes.GRANTS}/$grant", mapOf("publish" to true)).status)
        tokens(publish = true)
        assertEquals(2, grants.grants(player).size)
        assertTrue(grants.grants(player).none { it.can(EditorPermissions.PUBLISH) })
    }

    @Test
    fun `registration takes https or loopback redirects only`() {
        for (uri in listOf("http://evil.example/cb", "javascript:alert(1)", "https://x.example/cb#frag")) {
            val answer = http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("redirect_uris" to listOf(uri))))
            assertEquals(400, answer.status, uri)
        }
        assertEquals(201, http("POST", OAuthRoutes.REGISTER, mapper.writeValueAsString(mapOf("redirect_uris" to listOf("http://127.0.0.1:6274/oauth/callback")))).status)
        // An unknown client is never redirected to: the editor page says so.
        val unknown = http("GET", "${OAuthRoutes.AUTHORIZE}?client_id=nope&redirect_uri=https://evil.example/cb")
        assertEquals("${OAuthRoutes.CONSENT_PAGE}?error=invalid_client", unknown.headers.firstValue("Location").get())
    }

    @Test
    fun `another site cannot use the editor cookie on the MCP endpoint or the consent`() {
        val foreign = mapOf("Cookie" to cookie, "Origin" to "https://evil.example")
        assertEquals(401, rpc(null, "ping", headers = foreign).status)
        assertEquals(200, rpc(null, "ping", headers = mapOf("Cookie" to cookie)).status)
        val clientId = registerClient()
        val consent = http("POST", OAuthRoutes.CONSENT, mapper.writeValueAsString(mapOf("client_id" to clientId, "redirect_uri" to redirect, "approve" to true, "code_challenge" to McpGrants.challenge(verifier))),
            foreign + ("Content-Type" to "application/json"))
        assertEquals(403, consent.status)
        assertNotNull(grants.client(clientId))
        assertTrue(grants.grants(player).isEmpty())
    }
}
