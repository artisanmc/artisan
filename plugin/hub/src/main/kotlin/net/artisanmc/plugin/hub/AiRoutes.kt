package net.artisanmc.plugin.hub

import net.artisanmc.plugin.hub.EditorPermissions.CONFIG
import net.artisanmc.plugin.hub.EditorPermissions.EDIT
import net.artisanmc.plugin.hub.EditorPermissions.VIEW

/**
 * The editor's assistant (ADR `editor-assistant`). Same-origin, signed in, `edit` to talk to it,
 * `config` to set it up. Without settings, only [STATUS], [CONFIG] and [CLOUD] answer.
 */
class AiRoutes(
    private val setup: AiSetup,
    /** The network's link to its site account: the `artisan` provider's credits and models ([CLOUD]); null: none. */
    private val site: SiteAccount? = null,
) {
    fun register(router: Router) {
        router.on("GET", STATUS, VIEW) { call ->
            val assistant = setup.assistant()
            call.json(
                mapOf(
                    "enabled" to (assistant != null), "model" to assistant?.model, "canUse" to (assistant != null && call.session!!.can(EDIT)),
                    "attachments" to assistant?.attachments?.map { it.id }?.sorted(),
                    // On the linked account's credits: the editor shows the balance.
                    "cloud" to (setup.current().config.provider == AiConfig.ARTISAN),
                    // The image model generate_image calls, when one is set: the assistant then offers pictures.
                    "imageModel" to setup.current().images?.model?.model,
                ),
            )
        }
        // The linked account's AI credits and the models artisanmc.net offers: asked of the site, off the request's thread.
        router.on("GET", CLOUD, VIEW) { call ->
            val account = site ?: return@on call.json(mapOf("linked" to false))
            if (account.link() == null) return@on call.json(mapOf("linked" to false))
            val fresh = call.query("fresh") == "1"
            call.offload {
                try {
                    val ai = account.ai(fresh)
                    call.json(
                        mapOf(
                            "linked" to true, "balance" to ai.balance, "buy" to ai.buy,
                            "models" to ai.models.map { mapOf("id" to it.id, "label" to it.label, "protocol" to it.protocol, "attachments" to it.attachments.map { k -> k.id }.sorted()) },
                        ),
                    )
                } catch (e: SiteFailure) {
                    if (e.code == "site_not_linked") call.json(mapOf("linked" to false)) else call.error(502, e.code)
                }
            }
        }
        router.on("GET", CONFIG_PATH, CONFIG) { call -> call.json(config()) }
        router.on("PUT", CONFIG_PATH, CONFIG) { call ->
            if (!setup.editable) return@on call.error(409, "ai_config_in_file")
            val body = call.body() ?: return@on call.error(422, "invalid_input")
            val saved = setup.current().config.takeIf { setup.current().source == AiSetup.Source.DATABASE }
            val next = when (val parsed = parse(body, saved)) {
                is Parsed.Invalid -> return@on call.error(422, parsed.code, parsed.field)
                is Parsed.Valid -> parsed.config
            }
            store(call) { setup.save(next) }
        }
        router.on("DELETE", CONFIG_PATH, CONFIG) { call ->
            if (!setup.editable) return@on call.error(409, "ai_config_in_file")
            store(call) { setup.save(null) }
        }
        router.on("GET", CONVERSATIONS, EDIT) { call ->
            val assistant = setup.assistant() ?: return@on call.error(404, "ai_disabled")
            call.json(mapOf("conversations" to assistant.list(call.session!!).map(::summary)))
        }
        router.on("POST", CONVERSATIONS, EDIT) { call ->
            val assistant = setup.assistant() ?: return@on call.error(404, "ai_disabled")
            val body = call.body()
            val project = body?.path("project")?.asText("")?.takeIf { it.isNotBlank() }?.take(200)
            val server = body?.path("server")?.asText("")?.takeIf { it.isNotBlank() }
            if (server != null && !SERVER_ID.matches(server)) return@on call.error(422, "invalid_input", "server")
            call.json(summary(assistant.start(call.session!!, project, server).summary()), 201)
        }
        router.on("POST", TRANSLATE, EDIT) { call ->
            val assistant = setup.assistant() ?: return@on call.error(404, "ai_disabled")
            val request = translation(call.body()) ?: return@on call.error(422, "invalid_input")
            try {
                val result = assistant.translator.translate(request)
                call.json(
                    mapOf(
                        "translations" to result.translations, "failed" to result.failed,
                        "inputTokens" to result.inputTokens, "outputTokens" to result.outputTokens,
                    ),
                )
            } catch (e: AiFailure) {
                call.error(502, e.code)
            }
        }
        router.on("GET", "$CONVERSATIONS/:conversation", EDIT) { call ->
            val assistant = setup.assistant() ?: return@on call.error(404, "not_found")
            val conversation = assistant.get(call.session!!, call.params.getValue("conversation")) ?: return@on call.error(404, "not_found")
            val after = call.query("after")?.toIntOrNull() ?: 0
            // `running` before the events: the turn adds `done` before it stops running, so a
            // conversation read as stopped always carries its `done`.
            val summary = summary(conversation.summary())
            // The events first, then what is being written: a step that ends between the two shows in neither, never in both.
            val events = conversation.after(after).map { mapOf("seq" to it.seq, "type" to it.type) + it.data }
            val live = conversation.live()
            call.json(summary + ("events" to events) + ("live" to live))
        }
        router.on("POST", "$CONVERSATIONS/:conversation/messages", EDIT) { call ->
            val assistant = setup.assistant() ?: return@on call.error(404, "not_found")
            val bytes = call.bytes(MAX_MESSAGE_BODY) ?: return@on call.error(413, "ai_attachment_too_large")
            val body = runCatching { Call.mapper.readTree(bytes) }.getOrNull() ?: return@on call.error(422, "invalid_input")
            val text = body.path("text").asText("").trim()
            val attachments = when (val parsed = AiAttachment.parse(body.get("attachments"))) {
                is AiAttachment.Parsed.Invalid -> return@on call.error(parsed.status, parsed.code)
                is AiAttachment.Parsed.Valid -> parsed.attachments
            }
            // A kind the model does not read (an image to DeepSeek): refused, rather than an error from the provider.
            if (attachments.any { it.kind !in assistant.attachments }) return@on call.error(422, "ai_attachment_model")
            if ((text.isEmpty() && attachments.isEmpty()) || text.length > MAX_MESSAGE) return@on call.error(422, "invalid_input")
            when (assistant.send(call.session!!, call.params.getValue("conversation"), text, attachments)) {
                AiAssistant.Sent.Accepted -> call.json(mapOf("ok" to true), 202)
                AiAssistant.Sent.Busy -> call.error(409, "ai_busy")
                AiAssistant.Sent.NotFound -> call.error(404, "not_found")
                AiAssistant.Sent.TooLarge -> call.error(413, "ai_conversation_full")
            }
        }
        // The player's answer to a question the assistant asked before a paid tool (generate_image): once, always or denied.
        router.on("POST", "$CONVERSATIONS/:conversation/permissions/:request", EDIT) { call ->
            val assistant = setup.assistant() ?: return@on call.error(404, "not_found")
            val conversation = assistant.get(call.session!!, call.params.getValue("conversation")) ?: return@on call.error(404, "not_found")
            val answer = call.body()?.path("answer")?.asText("")?.takeIf { it in AiAssistant.ANSWERS } ?: return@on call.error(422, "invalid_input", "answer")
            if (conversation.answer(call.params.getValue("request"), answer)) call.json(mapOf("ok" to true)) else call.error(409, "ai_permission_closed")
        }
        // The paid tools the player always allows the assistant, and taking one back.
        router.on("GET", PERMISSIONS, EDIT) { call ->
            try {
                call.json(mapOf("always" to setup.permissions.allowed(call.session!!.playerId).sorted()))
            } catch (e: Exception) {
                call.error(503, "database_unavailable")
            }
        }
        router.on("DELETE", "$PERMISSIONS/:tool", EDIT) { call ->
            try {
                setup.permissions.set(call.session!!.playerId, call.params.getValue("tool"), false)
                call.json(mapOf("always" to setup.permissions.allowed(call.session!!.playerId).sorted()))
            } catch (e: Exception) {
                call.error(503, "database_unavailable")
            }
        }
        // A picture generate_image made for this player, while the hub keeps it: shown in the conversation.
        router.on("GET", "$GENERATED/:name", EDIT) { call ->
            val bytes = setup.generated.of(call.session!!.playerId)[call.params.getValue("name")] ?: return@on call.error(404, "not_found")
            call.send(200, if (McpImages.lossy(bytes)) "image/jpeg" else "image/png", bytes)
        }
        router.on("DELETE", "$CONVERSATIONS/:conversation", EDIT) { call ->
            val assistant = setup.assistant() ?: return@on call.error(404, "not_found")
            if (assistant.delete(call.session!!, call.params.getValue("conversation"))) call.json(mapOf("ok" to true))
            else call.error(404, "not_found")
        }
    }

    /** The settings as the editor shows them: the key never leaves the hub, only its last characters. */
    private fun config(): Map<String, Any?> {
        val current = setup.current()
        val c = current.config
        return mapOf(
            "source" to current.source.id,
            "editable" to setup.editable,
            "enabled" to (current.assistant != null),
            "provider" to c.provider.ifBlank { null },
            "model" to c.model,
            "effort" to c.effort,
            "maxSteps" to c.maxSteps,
            "baseUrl" to c.baseUrl,
            // A short key keeps its end to itself: "…" alone still says one is saved.
            "keyHint" to c.apiKey.takeIf { it.isNotBlank() }?.let { if (it.length >= 12) "…" + it.takeLast(4) else "…" },
            "providers" to AiConfig.PROVIDERS.sorted(),
            "efforts" to EFFORTS,
            "defaultModel" to AiConfig.DEFAULT_MODEL,
            // The image model generate_image calls; `provider` null: none.
            "image" to mapOf(
                "enabled" to (current.images != null),
                "provider" to c.image.provider.ifBlank { null },
                "model" to c.image.model,
                "baseUrl" to c.image.baseUrl,
                "dailyLimit" to c.image.dailyLimit,
                "keyHint" to c.image.apiKey.takeIf { it.isNotBlank() }?.let { if (it.length >= 12) "…" + it.takeLast(4) else "…" },
            ),
            "imageProviders" to AiImageConfig.PROVIDERS.sorted(),
            "imageDefaultModels" to AiImageConfig.DEFAULT_MODELS,
        )
    }

    private fun store(call: Call, save: () -> Unit) = try {
        save()
        call.json(config())
    } catch (e: Exception) {
        call.error(503, "database_unavailable")
    }

    private sealed interface Parsed {
        data class Valid(val config: AiConfig) : Parsed
        data class Invalid(val code: String, val field: String) : Parsed
    }

    /**
     * The settings in [body], over the [saved] ones: a key left out keeps the saved one, unless the
     * provider or the address changes, which could send it elsewhere.
     */
    private fun parse(body: com.fasterxml.jackson.databind.JsonNode, saved: AiConfig?): Parsed {
        fun text(field: String) = body.path(field).takeIf { it.isTextual }?.asText()?.trim()
        // `image` left out (an editor that does not know it): the saved one stays.
        val image = when (val parsed = if (body.has("image")) image(body.get("image"), saved?.image) else ParsedImage.Valid(saved?.image ?: AiImageConfig())) {
            is ParsedImage.Invalid -> return Parsed.Invalid(parsed.code, parsed.field)
            is ParsedImage.Valid -> parsed.config
        }
        val provider = text("provider")?.lowercase().orEmpty()
        // No assistant, an image model alone: what an MCP app's generate_image needs.
        if (provider.isEmpty() && image.provider.isNotEmpty()) return Parsed.Valid(AiConfig(image = image))
        if (provider !in AiConfig.PROVIDERS) return Parsed.Invalid("invalid_input", "provider")
        val model = text("model").orEmpty()
        if (model.isEmpty() || model.length > 128 || model.any { it.isWhitespace() }) return Parsed.Invalid("invalid_input", "model")
        val effort = text("effort")?.lowercase().orEmpty()
        if (effort !in EFFORTS) return Parsed.Invalid("invalid_input", "effort")
        val maxSteps = body.path("maxSteps").takeIf { it.isInt }?.asInt() ?: return Parsed.Invalid("invalid_input", "maxSteps")
        if (maxSteps !in 1..100) return Parsed.Invalid("invalid_input", "maxSteps")
        // artisanmc.net's models: no key, no address, the site link pays.
        if (provider == AiConfig.ARTISAN) return Parsed.Valid(AiConfig(provider, "", model, effort, maxSteps, "", image))
        val baseUrl = text("baseUrl").orEmpty().trimEnd('/')
        if (baseUrl.isNotEmpty() && !validUrl(baseUrl)) return Parsed.Invalid("invalid_input", "baseUrl")
        val key = text("apiKey")?.takeIf { it.isNotEmpty() }
        if (key != null && (key.length > 500 || key.any { it.isWhitespace() })) return Parsed.Invalid("invalid_input", "apiKey")
        val kept = saved?.takeIf { it.provider == provider && it.baseUrl == baseUrl }?.apiKey?.takeIf { it.isNotBlank() }
        val apiKey = key ?: kept ?: return Parsed.Invalid(if (saved?.apiKey.isNullOrBlank()) "ai_key_missing" else "ai_key_required", "apiKey")
        return Parsed.Valid(AiConfig(provider, apiKey, model, effort, maxSteps, baseUrl, image))
    }

    private sealed interface ParsedImage {
        data class Valid(val config: AiImageConfig) : ParsedImage
        data class Invalid(val code: String, val field: String) : ParsedImage
    }

    /** The `image` settings in [node] over the [saved] ones, its key kept like the assistant's; null or no provider: none. */
    private fun image(node: com.fasterxml.jackson.databind.JsonNode, saved: AiImageConfig?): ParsedImage {
        fun text(field: String) = node.path(field).takeIf { it.isTextual }?.asText()?.trim()
        val provider = text("provider")?.lowercase().orEmpty()
        if (node.isNull || provider.isEmpty()) return ParsedImage.Valid(AiImageConfig())
        if (provider !in AiImageConfig.PROVIDERS) return ParsedImage.Invalid("invalid_input", "image.provider")
        val model = text("model").orEmpty()
        if (model.length > 128 || model.any { it.isWhitespace() }) return ParsedImage.Invalid("invalid_input", "image.model")
        val baseUrl = text("baseUrl").orEmpty().trimEnd('/')
        if (baseUrl.isNotEmpty() && !validUrl(baseUrl)) return ParsedImage.Invalid("invalid_input", "image.baseUrl")
        val limit = node.get("dailyLimit")?.let { it.takeIf { n -> n.isInt }?.asInt()?.takeIf { n -> n in 0..10_000 } ?: return ParsedImage.Invalid("invalid_input", "image.dailyLimit") }
            ?: AiImageConfig.DEFAULT_DAILY_LIMIT
        val key = text("apiKey")?.takeIf { it.isNotEmpty() }
        if (key != null && (key.length > 500 || key.any { it.isWhitespace() })) return ParsedImage.Invalid("invalid_input", "image.apiKey")
        val kept = saved?.takeIf { it.provider == provider && it.baseUrl == baseUrl }?.apiKey?.takeIf { it.isNotBlank() }
        val apiKey = key ?: kept ?: return ParsedImage.Invalid(if (saved?.apiKey.isNullOrBlank()) "ai_key_missing" else "ai_key_required", "image.apiKey")
        return ParsedImage.Valid(AiImageConfig(provider, apiKey, model, baseUrl, limit))
    }

    /** A translation request within [AiTranslator]'s limits, or null. */
    private fun translation(body: com.fasterxml.jackson.databind.JsonNode?): AiTranslator.Request? {
        body ?: return null
        val source = body.path("source").asText("").takeIf { AiTranslator.LANG.matches(it) } ?: return null
        val targets = body.path("targets").map { it.asText("") }.distinct()
        if (targets.isEmpty() || targets.size > AiTranslator.MAX_TARGETS || targets.any { !AiTranslator.LANG.matches(it) || it == source }) return null
        val texts = body.path("texts").map { node ->
            val id = node.path("id").asText("").takeIf { it.isNotEmpty() && it.length <= 200 } ?: return null
            val text = node.path("text").asText("").takeIf { it.isNotBlank() && it.length <= AiTranslator.MAX_TEXT } ?: return null
            AiTranslator.Text(id, text, node.path("context").asText("").take(300).ifBlank { null })
        }
        if (texts.isEmpty() || texts.size > AiTranslator.MAX_TEXTS || texts.distinctBy { it.id }.size != texts.size) return null
        if (texts.sumOf { it.text.length } * targets.size > AiTranslator.MAX_OUTPUT_CHARS) return null
        val module = body.path("module").asText("").take(200).ifBlank { null }
        return AiTranslator.Request(source, targets, texts, module)
    }

    private fun validUrl(url: String): Boolean {
        if (url.length > 300) return false
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return false
        return uri.scheme in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null
    }

    private fun summary(c: AiAssistant.Summary) = mapOf(
        "id" to c.id, "project" to c.project, "server" to c.server, "title" to c.title, "running" to c.running,
        "createdAt" to c.createdAt.toString(), "lastActive" to c.lastActive.toString(),
        "inputTokens" to c.inputTokens, "outputTokens" to c.outputTokens,
    )

    companion object {
        const val STATUS = "/api/v1/ai"
        const val CONFIG_PATH = "/api/v1/ai/config"
        const val CONVERSATIONS = "/api/v1/ai/conversations"
        const val TRANSLATE = "/api/v1/ai/translate"
        const val CLOUD = "/api/v1/ai/cloud"
        const val PERMISSIONS = "/api/v1/ai/permissions"
        const val GENERATED = "/api/v1/ai/generated"
        const val MAX_MESSAGE = 8000
        /** A message with its files in base64 ([AiAttachment.MAX_MESSAGE]), and room for the JSON around them. */
        const val MAX_MESSAGE_BODY = 8_500_000
        /** A server id goes into the model's instructions: only the characters ids are made of. */
        private val SERVER_ID = Regex("[A-Za-z0-9_-]{1,64}")
        val EFFORTS = listOf("low", "medium", "high", "xhigh", "max")
    }
}
