package net.artisanmc.plugin.hub

import java.net.URI
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.logging.Logger

/**
 * Where the assistant's settings saved from the editor live: the suite database, so every hub of
 * the network reads the same (ADR `editor-assistant`). The key is stored as given: whoever reads
 * the database already controls the network.
 */
interface AiSettingsStore {
    /** The saved settings, null when none. Throws while the database is not open yet. */
    fun read(): AiConfig?

    /** Saves [config]; null deletes it. Throws when the database cannot be written. */
    fun write(config: AiConfig?)
}

/**
 * What a player answered "always" to when the assistant asked before a paid tool
 * (`generate_image`): the tools' names, per player, kept with the settings. The player takes one
 * back in the assistant's settings.
 */
interface AiPermissionStore {
    /** The tools [player] always allows. Throws while the database is not open yet. */
    fun allowed(player: java.util.UUID): Set<String>

    fun set(player: java.util.UUID, tool: String, allow: Boolean)
}

class MemoryAiPermissionStore : AiPermissionStore {
    private val byPlayer = java.util.concurrent.ConcurrentHashMap<java.util.UUID, Set<String>>()
    override fun allowed(player: java.util.UUID) = byPlayer[player].orEmpty()
    override fun set(player: java.util.UUID, tool: String, allow: Boolean) {
        byPlayer.compute(player) { _, tools -> (if (allow) tools.orEmpty() + tool else tools.orEmpty() - tool).ifEmpty { null } }
    }
}

class MemoryAiSettingsStore(@Volatile private var config: AiConfig? = null) : AiSettingsStore {
    override fun read() = config
    override fun write(config: AiConfig?) {
        this.config = config
    }
}

/**
 * The assistant the hub runs, the image model `generate_image` calls, and the settings they run
 * on. environment.yml's `ai` section wins when it names a provider (the assistant's or the image
 * model's): the editor shows it, read-only. Otherwise the settings saved from the
 * editor ([store]), read once the database answers, and applied at once when they change: the
 * assistant is rebuilt; it takes the conversations back from [conversations] (without it, they end).
 *
 * The servers of one database share a tunnel address and each serves the editor (ADR
 * `peer-servers`): a save on one reaches the others within [refresh], when they read the
 * settings again.
 */
class AiSetup(
    private val file: AiConfig,
    private val store: AiSettingsStore?,
    private val tools: McpTools,
    private val logger: Logger?,
    /** Builds the model service for a configuration; null: the provider is unknown. */
    private val providerFor: (AiConfig) -> AiProvider? = ::defaultProvider,
    private val refresh: Duration = Duration.ofSeconds(30),
    private val clock: Clock = Clock.systemUTC(),
    /** Where conversations outlive the assistant; null: in its memory alone. */
    private val conversations: AiConversationStore? = null,
    /** Builds the image model service for a configuration; null: none, or a provider that is not known. */
    private val imageFor: (AiImageConfig) -> ImageModel? = { AiImageConfig.service(it) },
    /** What each player always allows the assistant; in memory when the hub has no database. */
    val permissions: AiPermissionStore = MemoryAiPermissionStore(),
) {
    enum class Source(val id: String) { FILE("file"), DATABASE("database"), NONE("none") }

    /** [images]: the image model in service, with or without an assistant (an MCP app may use it alone). */
    data class Current(val config: AiConfig, val source: Source, val assistant: AiAssistant?, val images: ImageService? = null)

    /** The pictures the image model made, by player: the editor shows them in the conversation. */
    val generated: GeneratedPictures get() = tools.generated

    @Volatile private var current: Current? = null

    /** When [store] was last read: older than [refresh], the next call reads it again. */
    @Volatile private var readAt: Instant = Instant.EPOCH

    /** The assistant, null when none is configured (or the database has not answered yet). */
    fun assistant(): AiAssistant? = current().assistant

    fun current(): Current {
        val known = current
        return if (known != null && (known.source == Source.FILE || !stale())) known else load()
    }

    /** Whether the editor may change the settings: not when environment.yml sets them. */
    val editable: Boolean get() = !fromFile

    private val fromFile: Boolean get() = file.provider.isNotBlank() || file.image.provider.isNotBlank()

    private fun stale() = Duration.between(readAt, clock.instant()) >= refresh

    @Synchronized
    private fun load(): Current {
        current?.takeIf { it.source == Source.FILE || !stale() }?.let { return it }
        if (fromFile) return apply(file, Source.FILE)
        val saved = try {
            store?.read()
        } catch (e: Exception) {
            // The database is still opening (or failing): what was read last stays, asked again on the next call.
            return current ?: Current(AiConfig(), Source.NONE, null)
        }
        readAt = clock.instant()
        // Unchanged (another server saved nothing new): the assistant and its conversations stay.
        current?.takeIf { it.config == (saved ?: AiConfig()) && it.source != Source.FILE }?.let { return it }
        return apply(saved, if (saved == null) Source.NONE else Source.DATABASE)
    }

    /** Saves [config] (null: turns the assistant off) and runs it. Throws when it cannot be stored. */
    @Synchronized
    fun save(config: AiConfig?): Current {
        check(editable) { "ai is set in environment.yml" }
        val store = store ?: throw IllegalStateException("no database to keep the assistant's settings")
        store.write(config)
        readAt = clock.instant()
        return apply(config, if (config == null) Source.NONE else Source.DATABASE)
    }

    private fun apply(config: AiConfig?, source: Source): Current {
        val previous = current
        val next = Current(config ?: AiConfig(), source, config?.let(::build), config?.image?.let(::images))
        current = next
        previous?.assistant?.takeIf { it !== next.assistant }?.close()
        return next
    }

    private fun images(config: AiImageConfig): ImageService? {
        if (config.provider.isBlank()) return null
        val model = imageFor(config) ?: run {
            logger?.warning("[Artisan] ai.image: provider '${config.provider}' needs a key and to be one of ${AiImageConfig.PROVIDERS}: no generate_image")
            return null
        }
        logger?.info("[Artisan] Image model enabled: ${config.provider} API, model ${model.model}")
        return ImageService(model, config.dailyLimit)
    }

    private fun build(config: AiConfig): AiAssistant? {
        if (!config.enabled) return null
        val provider = providerFor(config) ?: run {
            if (config.provider == AiConfig.ARTISAN) logger?.warning("[Artisan] ai.provider 'artisan' needs the site account (site.url): no assistant")
            else logger?.warning("[Artisan] ai.provider '${config.provider}' is not one of ${AiConfig.PROVIDERS}: no assistant")
            return null
        }
        logger?.info("[Artisan] Editor assistant enabled: ${describe(config)}")
        return AiAssistant(provider, tools, config.maxSteps, logger, store = conversations, permissions = permissions)
    }

    companion object {
        /** [site]: the network's link to its site account, which the `artisan` provider needs; without it, no such provider. */
        fun defaultProvider(config: AiConfig, site: SiteAccount? = null): AiProvider? = when (config.provider) {
            "anthropic" -> AnthropicProvider(config)
            "openai" -> OpenAiProvider(config)
            AiConfig.ARTISAN -> site?.let { CloudProvider(config, it) }
            else -> null
        }

        /** The protocol, where it is sent and the model: either with a base URL is another vendor's compatible API. */
        fun describe(config: AiConfig): String {
            if (config.provider == AiConfig.ARTISAN) return "artisanmc.net (linked account's credits), model ${config.model}"
            val host = config.baseUrl.takeIf { it.isNotBlank() }?.let { runCatching { URI(it).host }.getOrNull() ?: it }
            return "${config.provider} API" + (host?.let { " at $it" } ?: "") + ", model ${config.model}"
        }
    }
}
