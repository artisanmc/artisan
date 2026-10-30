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

class MemoryAiSettingsStore(@Volatile private var config: AiConfig? = null) : AiSettingsStore {
    override fun read() = config
    override fun write(config: AiConfig?) {
        this.config = config
    }
}

/**
 * The assistant the hub runs and the settings it runs on. environment.yml's `ai` section wins when
 * it names a provider: the editor shows it, read-only. Otherwise the settings saved from the
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
) {
    enum class Source(val id: String) { FILE("file"), DATABASE("database"), NONE("none") }

    data class Current(val config: AiConfig, val source: Source, val assistant: AiAssistant?)

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

    private val fromFile: Boolean get() = file.provider.isNotBlank()

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
        val next = Current(config ?: AiConfig(), source, config?.let(::build))
        current = next
        previous?.assistant?.takeIf { it !== next.assistant }?.close()
        return next
    }

    private fun build(config: AiConfig): AiAssistant? {
        if (!config.enabled) return null
        val provider = providerFor(config) ?: run {
            logger?.warning("[Artisan] ai.provider '${config.provider}' is not one of ${AiConfig.PROVIDERS}: no assistant")
            return null
        }
        logger?.info("[Artisan] Editor assistant enabled: ${describe(config)}")
        return AiAssistant(provider, tools, config.maxSteps, logger, store = conversations)
    }

    companion object {
        fun defaultProvider(config: AiConfig): AiProvider? = when (config.provider) {
            "anthropic" -> AnthropicProvider(config)
            else -> null
        }

        /** The protocol, where it is sent and the model: `anthropic` with a base URL is another vendor's compatible API. */
        fun describe(config: AiConfig): String {
            val host = config.baseUrl.takeIf { it.isNotBlank() }?.let { runCatching { URI(it).host }.getOrNull() ?: it }
            return "${config.provider} API" + (host?.let { " at $it" } ?: "") + ", model ${config.model}"
        }
    }
}
