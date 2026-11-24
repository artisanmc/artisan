package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URI
import java.time.Duration
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * The `ai.image` settings (design `design-ia-menus-assets`, section 6): the image model
 * `generate_image` calls, on the admin's own key. A chat model draws small pixel art itself; an
 * image model is for what it cannot draw in a grid (an illustration, a painted background).
 * Empty: the tool is not offered, and everything else works.
 */
data class AiImageConfig(
    /** `openai` (the Images API, GPT Image models) or `google` (the Gemini API's image models); empty: none. */
    val provider: String = "",
    val apiKey: String = "",
    /** Empty: the provider's default ([DEFAULT_MODELS]). */
    val model: String = "",
    /** Another address for the provider's API (a proxy); empty: its own. */
    val baseUrl: String = "",
    /** Pictures one player may ask for in a day (UTC), all apps and the assistant together; 0: no limit. */
    val dailyLimit: Int = DEFAULT_DAILY_LIMIT,
) {
    val enabled: Boolean get() = provider in PROVIDERS && apiKey.isNotBlank()

    /** The model asked of the provider. */
    val usedModel: String get() = model.ifBlank { DEFAULT_MODELS[provider].orEmpty() }

    companion object {
        val PROVIDERS = setOf("openai", "google")
        val DEFAULT_MODELS = mapOf("openai" to "gpt-image-1", "google" to "gemini-2.5-flash-image")
        const val DEFAULT_DAILY_LIMIT = 40

        /** The model service of [config]; null when it names none, or one that is not known. */
        fun service(config: AiImageConfig): ImageModel? = when {
            !config.enabled -> null
            config.provider == "openai" -> OpenAiImages(config)
            config.provider == "google" -> GoogleImages(config)
            else -> null
        }
    }
}

/** What `generate_image` asks of an image model. */
class ImageRequest(
    val prompt: String,
    val shape: Shape,
    /** A transparent background, for a model that makes one ([ImageModel.transparency]). */
    val transparent: Boolean,
    /** Pictures the model works from (a style, an element to redraw), as PNG files. */
    val references: List<Reference> = emptyList(),
) {
    class Reference(val name: String, val png: ByteArray)

    /** Image models draw at a few fixed sizes around a megapixel: the shape is all that is chosen. */
    enum class Shape(val id: String, val openAiSize: String, val ratio: String) {
        SQUARE("square", "1024x1024", "1:1"),
        WIDE("wide", "1536x1024", "3:2"),
        TALL("tall", "1024x1536", "2:3"),
        ;

        companion object {
            fun of(id: String): Shape? = entries.firstOrNull { it.id == id }
        }
    }
}

/** A picture an image model made: the file as it came (a PNG, sometimes a JPEG). */
class GeneratedImage(val bytes: ByteArray)

/** The image model in service, and how many pictures a player may ask of it in a day (0: no limit). */
class ImageService(val model: ImageModel, val dailyLimit: Int)

/** An image model service. A call costs the admin money: `generate_image` alone makes one. */
interface ImageModel {
    val model: String

    /** Whether it makes a transparent background when asked; otherwise the prompt asks for a flat one, removed when the image is cut. */
    val transparency: Boolean

    /** Blocking, up to a few minutes. Throws [AiFailure]. */
    fun generate(request: ImageRequest): GeneratedImage
}

private val JSON = "application/json".toMediaType()
private val PNG = "image/png".toMediaType()

private fun imageClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(Duration.ofSeconds(10))
    // An image takes from a few seconds to a few minutes, with nothing sent meanwhile.
    .readTimeout(Duration.ofMinutes(5))
    .build()

private fun failure(host: String, status: Int, message: String): AiFailure = when (status) {
    401, 403 -> AiFailure("ai_key_refused", "$host refused the image API key: $message")
    402, 429 -> AiFailure("ai_rate_limited", "$host limit: $message")
    400 -> AiFailure("ai_image_refused", "$host refused the request: $message")
    else -> AiFailure("ai_provider_error", "$host answered $status: $message")
}

private fun send(client: OkHttpClient, host: String, request: Request): JsonNode = try {
    client.newCall(request).execute().use { response ->
        val text = response.body?.string().orEmpty()
        val body = runCatching { Call.mapper.readTree(text) }.getOrNull()
        if (!response.isSuccessful) throw failure(host, response.code, body?.path("error")?.path("message")?.asText("")?.ifBlank { null } ?: text.take(300))
        body ?: throw AiFailure("ai_provider_error", "$host answered something that is not JSON")
    }
} catch (e: IOException) {
    throw AiFailure("ai_unreachable", "$host could not be reached: ${e.message}", e)
}

private fun decode(host: String, base64: String?): GeneratedImage {
    val bytes = base64?.takeIf { it.isNotBlank() }?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() }
        ?: throw AiFailure("ai_provider_error", "$host answered without an image")
    return GeneratedImage(bytes)
}

/**
 * OpenAI's Images API with a GPT Image model (`gpt-image-1` and its successors): `images/generations`,
 * or `images/edits` when there are references. The fields sent are those GPT Image models read
 * (`background`, `output_format`); DALL·E models refuse them.
 */
class OpenAiImages(private val config: AiImageConfig, private val client: OkHttpClient = imageClient()) : ImageModel {
    private val base = config.baseUrl.ifBlank { "https://api.openai.com/v1" }.trimEnd('/')
    private val host = runCatching { URI(base).host }.getOrNull() ?: base

    override val model: String get() = config.usedModel
    override val transparency: Boolean get() = true

    override fun generate(request: ImageRequest): GeneratedImage {
        val fields = linkedMapOf(
            "model" to model, "prompt" to request.prompt, "n" to "1", "size" to request.shape.openAiSize,
            "background" to (if (request.transparent) "transparent" else "opaque"), "output_format" to "png",
        )
        val http = Request.Builder().header("Authorization", "Bearer ${config.apiKey}")
        val body = if (request.references.isEmpty()) {
            http.url("$base/images/generations")
                .post(Call.mapper.writeValueAsString(fields.mapValues { (key, value) -> if (key == "n") 1 else value }).toRequestBody(JSON))
            send(client, host, http.build())
        } else {
            val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            fields.forEach { (key, value) -> form.addFormDataPart(key, value) }
            request.references.forEach { form.addFormDataPart("image[]", it.name, it.png.toRequestBody(PNG)) }
            send(client, host, http.url("$base/images/edits").post(form.build()).build())
        }
        return decode(host, body.path("data").path(0).path("b64_json").asText(""))
    }
}

/**
 * The Gemini API's image models (`gemini-2.5-flash-image` and its successors): `generateContent`
 * answering with an image part. They make no transparent background.
 */
class GoogleImages(private val config: AiImageConfig, private val client: OkHttpClient = imageClient()) : ImageModel {
    private val base = config.baseUrl.ifBlank { "https://generativelanguage.googleapis.com/v1beta" }.trimEnd('/')
    private val host = runCatching { URI(base).host }.getOrNull() ?: base

    override val model: String get() = config.usedModel
    override val transparency: Boolean get() = false

    override fun generate(request: ImageRequest): GeneratedImage {
        val parts = listOf(mapOf("text" to request.prompt)) + request.references.map {
            mapOf("inlineData" to mapOf("mimeType" to "image/png", "data" to Base64.getEncoder().encodeToString(it.png)))
        }
        val generation = linkedMapOf<String, Any?>("responseModalities" to listOf("TEXT", "IMAGE"))
        // Square is the model's own shape: the field is left out, for a model that would not read it.
        if (request.shape != ImageRequest.Shape.SQUARE) generation["imageConfig"] = mapOf("aspectRatio" to request.shape.ratio)
        val payload = mapOf("contents" to listOf(mapOf("role" to "user", "parts" to parts)), "generationConfig" to generation)
        val body = send(
            client, host,
            Request.Builder().url("$base/models/$model:generateContent").header("x-goog-api-key", config.apiKey)
                .post(Call.mapper.writeValueAsString(payload).toRequestBody(JSON)).build(),
        )
        body.path("promptFeedback").path("blockReason").asText("").takeIf { it.isNotBlank() }
            ?.let { throw AiFailure("ai_image_refused", "$host blocked the request: $it") }
        val image = body.path("candidates").flatMap { it.path("content").path("parts") }
            .firstOrNull { it.path("inlineData").path("data").isTextual || it.path("inline_data").path("data").isTextual }
        val data = image?.let { it.path("inlineData").path("data").asText("").ifBlank { it.path("inline_data").path("data").asText("") } }
        if (data.isNullOrBlank()) {
            val said = body.path("candidates").flatMap { it.path("content").path("parts") }.joinToString(" ") { it.path("text").asText("") }.trim()
            throw AiFailure("ai_image_refused", "$host made no image" + (if (said.isEmpty()) "" else ": ${said.take(300)}"))
        }
        return decode(host, data)
    }
}

/**
 * The pictures `generate_image` made, kept by the hub while it runs so that `measure_image` and
 * `write_image`'s `from` take one by its name, like a picture the player attached. Each player's
 * own, the last [PER_PLAYER] (a megapixel each): a picture is material to cut from, not a file of a Project.
 */
class GeneratedPictures(private val clock: java.time.Clock = java.time.Clock.systemUTC()) {
    private val byPlayer = ConcurrentHashMap<UUID, LinkedHashMap<String, ByteArray>>()
    private val counter = java.util.concurrent.atomic.AtomicInteger()

    /** How many pictures each player asked for on [day]: the guard against a model that loops on a paid tool. */
    private var day: java.time.LocalDate = java.time.LocalDate.EPOCH
    private val asked = HashMap<UUID, Int>()

    /**
     * Counts one more picture for [player] today (UTC) and returns true, or false when [limit]
     * (0: none) is reached. Counted before the call, so two calls at once cannot both pass the
     * last one; [giveBack] when the model made nothing. In memory: a restart starts the day again.
     */
    @Synchronized
    fun spend(player: UUID, limit: Int): Boolean {
        val today = java.time.LocalDate.now(clock)
        if (today != day) {
            day = today
            asked.clear()
        }
        val count = asked[player] ?: 0
        if (limit > 0 && count >= limit) return false
        asked[player] = count + 1
        return true
    }

    /** The model failed or refused: the picture counted by [spend] is not one. */
    @Synchronized
    fun giveBack(player: UUID) {
        asked.computeIfPresent(player) { _, n -> (n - 1).coerceAtLeast(0) }
    }

    /** Keeps [bytes] for [player] and returns the name it goes by. */
    fun keep(player: UUID, bytes: ByteArray): String {
        val name = "generated-${counter.incrementAndGet()}.png"
        val pictures = byPlayer.computeIfAbsent(player) { LinkedHashMap() }
        synchronized(pictures) {
            pictures[name] = bytes
            while (pictures.size > PER_PLAYER) pictures.remove(pictures.keys.first())
        }
        return name
    }

    fun of(player: UUID): Map<String, ByteArray> = byPlayer[player]?.let { synchronized(it) { LinkedHashMap(it) } }.orEmpty()

    companion object {
        const val PER_PLAYER = 8
    }
}
