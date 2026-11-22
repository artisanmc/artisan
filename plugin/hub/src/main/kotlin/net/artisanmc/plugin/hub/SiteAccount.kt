package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Clock
import java.time.Duration
import java.time.Instant

/** The site account this network is linked to (ADR `site-account-and-module-updates`): its token, never shown. */
data class SiteLink(val token: String, val name: String, val linkedAt: Instant)

/**
 * Where the link lives: the suite database, so every server of the network reads the same. The
 * token is stored as given: whoever reads the database already controls the network.
 */
interface SiteLinkStore {
    /** The saved link, null when none. Throws while the database is not open yet. */
    fun read(): SiteLink?

    /** Saves [link]; null deletes it. Throws when the database cannot be written. */
    fun write(link: SiteLink?)
}

class MemorySiteLinkStore(@Volatile private var link: SiteLink? = null) : SiteLinkStore {
    override fun read() = link
    override fun write(link: SiteLink?) {
        this.link = link
    }
}

/** The site refused or did not answer: [code] is what the editor shows. */
class SiteFailure(val code: String, message: String? = null) : Exception(message ?: code)

/** The site's API for a game server: linking, then what its account may install. */
interface SiteApi {
    data class Started(val deviceCode: String, val userCode: String, val verificationUrl: String, val expiresIn: Long, val interval: Long)

    sealed interface Collected {
        data object Waiting : Collected
        data object Gone : Collected
        data class Linked(val token: String) : Collected
    }

    fun startLink(name: String): Started

    fun collect(deviceCode: String): Collected

    /** The catalogue for this account: `{channel, modules: […]}`. `site_unlinked` when the token is refused. */
    fun updates(token: String, channel: String, installed: Map<String, String>): JsonNode

    /** The account's AI credits and the models on offer: `{balance, models: […], buy}`. `site_unlinked` when the token is refused. */
    fun ai(token: String): JsonNode = throw SiteFailure("site_unreachable", "no AI on this site")
}

/** What artisanmc.net offers the linked account's assistant ([CloudProvider]): its balance in credits and the models. */
data class SiteAi(val balance: Double, val models: List<Model>, val buy: String?) {
    data class Model(val id: String, val label: String, val protocol: String, val attachments: Set<AiAttachment.Kind>)

    fun model(id: String) = models.firstOrNull { it.id == id }

    companion object {
        fun read(body: JsonNode) = SiteAi(
            balance = body.path("balance").asDouble(0.0),
            models = body.path("models").mapNotNull { node ->
                val id = node.path("id").asText("").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                val protocol = node.path("protocol").asText("").takeIf { it == "anthropic" || it == "openai" } ?: return@mapNotNull null
                val kinds = node.path("attachments").mapNotNull { kind -> AiAttachment.Kind.entries.firstOrNull { it.id == kind.asText() } }.toSet()
                Model(id, node.path("label").asText(id), protocol, kinds + AiAttachment.Kind.TEXT)
            },
            buy = body.path("buy").asText("").takeIf { it.startsWith("https://") || it.startsWith("http://") },
        )
    }
}

/** [SiteApi] over HTTPS. Every call blocks: never on a Jetty selector or a game thread. */
class HttpSiteApi(private val baseUrl: String, private val version: String = "") : SiteApi {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build()

    override fun startLink(name: String): SiteApi.Started {
        val (status, body) = post("/api/link/start/", mapOf("name" to name))
        if (status != 200) throw SiteFailure("site_unreachable", "link start answered $status")
        return SiteApi.Started(
            deviceCode = body.path("device_code").asText("").ifEmpty { throw SiteFailure("site_unreachable", "link start without a code") },
            userCode = body.path("user_code").asText(""),
            verificationUrl = body.path("verification_url").asText(""),
            expiresIn = body.path("expires_in").asLong(600),
            interval = body.path("interval").asLong(5),
        )
    }

    override fun collect(deviceCode: String): SiteApi.Collected {
        val (status, body) = post("/api/link/token/", mapOf("device_code" to deviceCode))
        return when (status) {
            200 -> body.path("token").asText("").takeIf { it.isNotEmpty() }?.let { SiteApi.Collected.Linked(it) }
                ?: throw SiteFailure("site_unreachable", "link token without a token")
            202 -> SiteApi.Collected.Waiting
            404, 410 -> SiteApi.Collected.Gone
            else -> throw SiteFailure("site_unreachable", "link token answered $status")
        }
    }

    override fun updates(token: String, channel: String, installed: Map<String, String>): JsonNode {
        val list = installed.entries.joinToString(",") { "${it.key}:${it.value}" }
        val query = "channel=${encode(channel)}" + if (list.isEmpty()) "" else "&installed=${encode(list)}"
        val request = builder("/api/updates/?$query").header("Authorization", "Bearer $token").GET().build()
        val (status, body) = send(request)
        return when (status) {
            200 -> body
            401 -> throw SiteFailure("site_unlinked")
            else -> throw SiteFailure("site_unreachable", "updates answered $status")
        }
    }

    override fun ai(token: String): JsonNode {
        val (status, body) = send(builder("/api/ai/").header("Authorization", "Bearer $token").GET().build())
        return when (status) {
            200 -> body
            401 -> throw SiteFailure("site_unlinked")
            else -> throw SiteFailure("site_unreachable", "ai answered $status")
        }
    }

    private fun post(path: String, body: Map<String, Any?>): Pair<Int, JsonNode> = send(
        builder(path).header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(Call.mapper.writeValueAsString(body))).build(),
    )

    private fun builder(path: String) = HttpRequest.newBuilder(URI.create(baseUrl + path))
        .timeout(Duration.ofSeconds(15))
        .header("Accept", "application/json")
        .header("User-Agent", "Artisan" + if (version.isEmpty()) "" else "/$version")

    private fun send(request: HttpRequest): Pair<Int, JsonNode> = try {
        val response = http.send(request, HttpResponse.BodyHandlers.ofString())
        response.statusCode() to (runCatching { Call.mapper.readTree(response.body()) }.getOrNull() ?: Call.mapper.createObjectNode())
    } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
        throw SiteFailure("site_unreachable", "interrupted")
    } catch (e: java.io.IOException) {
        throw SiteFailure("site_unreachable", e.message)
    }

    private fun encode(value: String) = URLEncoder.encode(value, Charsets.UTF_8)
}

/**
 * The network's link to a site account. Linking is the device flow: [start] asks the site for a
 * code, the owner approves it on the site signed in, [poll] collects the token, once. No secret is
 * typed or shown in the editor.
 *
 * The request in progress lives in this hub's memory: a restart ends it, the owner starts again.
 * The link itself is read from [store] at most every [refresh], so one made or removed on another
 * server of the database reaches this one.
 */
class SiteAccount(
    /** The site's address, from environment.yml (`site.url`): never set from the editor. */
    val baseUrl: String,
    private val store: SiteLinkStore?,
    private val api: SiteApi,
    private val clock: Clock = Clock.systemUTC(),
    private val refresh: Duration = Duration.ofSeconds(30),
) {
    data class Pending(val userCode: String, val verificationUrl: String, val expiresAt: Instant, internal val deviceCode: String, internal val interval: Duration, internal val name: String)

    @Volatile private var link: SiteLink? = null
    @Volatile private var readAt: Instant = Instant.EPOCH
    @Volatile private var pending: Pending? = null
    @Volatile private var polledAt: Instant = Instant.EPOCH
    /** A token collected while the database refused it: written at the next read, never asked twice. */
    @Volatile private var unsaved: SiteLink? = null

    /** The link, null when there is none (or the database has not answered yet). */
    @Synchronized
    fun link(): SiteLink? {
        val store = store ?: return null
        unsaved?.let { kept ->
            try {
                store.write(kept)
                unsaved = null
            } catch (_: Exception) {
                return kept
            }
        }
        if (Duration.between(readAt, clock.instant()) < refresh) return link
        try {
            link = store.read()
            readAt = clock.instant()
        } catch (_: Exception) {
            // The database is still opening (or failing): what was read last stays, asked again on the next call.
        }
        return link
    }

    /** The request waiting for the owner's approval, null when none or expired. */
    fun pending(): Pending? = pending?.takeIf { it.expiresAt.isAfter(clock.instant()) }.also { if (it == null) pending = null }

    /** Asks the site for a code. Throws [SiteFailure], or the database's own failure when the link could not be kept. */
    @Synchronized
    fun start(name: String): Pending {
        // Before a code is shown: a token collected with nowhere to keep it would be lost.
        checkNotNull(store) { "no database to keep the site link" }.read()
        val started = api.startLink(name)
        val now = clock.instant()
        polledAt = now
        return Pending(
            started.userCode, started.verificationUrl, now.plusSeconds(started.expiresIn.coerceIn(30, 3600)),
            started.deviceCode, Duration.ofSeconds(started.interval.coerceIn(1, 60)), name,
        ).also { pending = it }
    }

    /**
     * Asks the site whether the owner approved, no more often than it allows. Called when the
     * editor reads the link's state: nothing polls while nobody looks.
     */
    @Synchronized
    fun poll() {
        val waiting = pending() ?: return
        val now = clock.instant()
        if (Duration.between(polledAt, now) < waiting.interval) return
        polledAt = now
        when (val collected = try { api.collect(waiting.deviceCode) } catch (_: SiteFailure) { return }) {
            SiteApi.Collected.Waiting -> Unit
            SiteApi.Collected.Gone -> pending = null
            is SiteApi.Collected.Linked -> {
                val linked = SiteLink(collected.token, waiting.name, now)
                // The token is given once: if the database refuses it now, it is written at the next read.
                try {
                    store?.write(linked)
                } catch (_: Exception) {
                    unsaved = linked
                }
                link = linked
                readAt = now
                pending = null
            }
        }
    }

    /** Forgets the link here. The site keeps listing the server until its owner unlinks it there. */
    @Synchronized
    fun unlink() {
        pending = null
        unsaved = null
        store?.write(null)
        link = null
        ai = null
        readAt = clock.instant()
    }

    /** The site refused the token (unlinked there): the link is gone, nothing to keep. */
    fun refused() = try { unlink() } catch (_: Exception) {
        link = null
        ai = null
    }

    fun updates(channel: String, installed: Map<String, String>): JsonNode {
        val token = link()?.token ?: throw SiteFailure("site_not_linked")
        return try {
            api.updates(token, channel, installed)
        } catch (e: SiteFailure) {
            if (e.code == "site_unlinked") {
                refused()
                throw SiteFailure("site_not_linked")
            }
            throw e
        }
    }

    @Volatile private var ai: Pair<SiteAi, Instant>? = null

    /**
     * The credits and models of the linked account, asked of the site at most every [AI_REFRESH]
     * unless [fresh]. Blocks: never on a Jetty selector or a game thread. Throws [SiteFailure].
     */
    fun ai(fresh: Boolean = false): SiteAi {
        val now = clock.instant()
        ai?.takeIf { !fresh && Duration.between(it.second, now) < AI_REFRESH }?.let { return it.first }
        val token = link()?.token ?: throw SiteFailure("site_not_linked")
        val read = try {
            SiteAi.read(api.ai(token))
        } catch (e: SiteFailure) {
            if (e.code == "site_unlinked") {
                refused()
                throw SiteFailure("site_not_linked")
            }
            throw e
        }
        ai = read to now
        return read
    }

    /** What [ai] read last, without asking the site: null when it never did. */
    fun knownAi(): SiteAi? = ai?.first

    /** Where the assistant's calls go through the site ([CloudProvider]). */
    val aiEndpoint: String get() = baseUrl.trimEnd('/') + "/api/ai/chat/"

    companion object {
        const val DEFAULT_URL = "https://artisanmc.net"
        val AI_REFRESH: Duration = Duration.ofSeconds(60)
    }
}
