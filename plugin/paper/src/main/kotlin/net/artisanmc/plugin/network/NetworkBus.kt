package net.artisanmc.plugin.network

import net.artisanmc.modules.api.network.NetworkMessage
import net.artisanmc.modules.api.network.NetworkMessageHandler
import net.artisanmc.modules.api.network.NetworkPlayer
import net.artisanmc.plugin.database.NetworkPlayerRow
import net.artisanmc.plugin.database.NetworkRows
import java.time.Clock
import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.logging.Level
import java.util.logging.Logger

/**
 * The transport of `api.network` (design `reseau-artisan`), without Bukkit: channels over the
 * suite database's `network_messages`, and the players of the other servers read from
 * `network_players`. [tick] does one round (read, deliver, refresh); [SuiteNetwork] calls it
 * every [POLL] on one thread, so handlers see the messages in the order they were written.
 *
 * Until [rows] gives the tables (the suite database opens after `onEnable`, and never on H2),
 * messages for other servers wait in memory, [MAX_WAITING] at most, and nobody else is online.
 */
internal class NetworkBus(
    private val rows: () -> NetworkRows?,
    /** False on H2: a server alone, nothing to send to anyone. */
    private val shared: () -> Boolean,
    private val serverName: () -> String,
    private val logger: Logger,
    private val clock: Clock = Clock.systemUTC(),
) {
    private class Subscription(val loader: ClassLoader?, val handler: NetworkMessageHandler)

    private val subscriptions = ConcurrentHashMap<String, CopyOnWriteArrayList<Subscription>>()
    private val waiting = java.util.concurrent.ConcurrentLinkedQueue<Triple<String, String, Long>>()
    @Volatile private var lastId: Long? = null
    @Volatile private var lastPresence = java.time.Instant.EPOCH
    @Volatile private var lastPurge = java.time.Instant.EPOCH
    @Volatile private var dropWarned = false

    /** The players of the other servers, as last read; this server's own come from Bukkit. */
    @Volatile var remotePlayers: Map<UUID, NetworkPlayer> = emptyMap()
        private set
    /** The servers running, this one included once the tables are open; empty before. */
    @Volatile var servers: List<String> = emptyList()
        private set

    fun subscribe(loader: ClassLoader?, channel: String, handler: NetworkMessageHandler): () -> Unit {
        requireChannel(channel)
        val subscription = Subscription(loader, handler)
        val list = subscriptions.computeIfAbsent(channel) { CopyOnWriteArrayList() }
        list.add(subscription)
        return { list.remove(subscription) }
    }

    /** Removes the subscriptions a disabling plugin left; returns how many. */
    fun releaseLoadedBy(loader: ClassLoader): Int =
        subscriptions.values.sumOf { list -> list.filter { it.loader === loader }.also { list.removeAll(it.toSet()) }.size }

    /** Queued for the other servers; [deliverHere] runs this server's subscribers too, on the caller's thread. */
    fun publish(channel: String, payload: String, deliverHere: Boolean) {
        requireChannel(channel)
        require(payload.length <= MAX_PAYLOAD) { "Network payload of ${payload.length} characters on $channel: $MAX_PAYLOAD at most" }
        if (shared()) {
            if (waiting.size >= MAX_WAITING) {
                waiting.poll()
                if (!dropWarned) logger.warning("[Artisan] network: more than $MAX_WAITING messages wait for the database, the oldest are dropped")
                dropWarned = true
            }
            waiting.add(Triple(channel, payload, clock.millis()))
        }
        if (deliverHere) deliver(NetworkMessage(channel, serverName(), payload))
    }

    /** One round: writes what waits, reads what the others wrote, refreshes presence every [PRESENCE], purges every [PURGE]. */
    fun tick() {
        val table = rows() ?: return
        val now = clock.instant()
        try {
            val from = lastId ?: table.lastId().also { lastId = it }
            while (true) {
                val (channel, payload, at) = waiting.peek() ?: break
                if (now.toEpochMilli() - at > KEEP.toMillis()) {
                    waiting.poll()
                    continue
                }
                table.publish(serverName(), channel, payload, now)
                waiting.poll()
            }
            var after = from
            for (row in table.after(after)) {
                after = row.id
                if (row.serverFrom.equals(serverName(), ignoreCase = true)) continue
                deliver(NetworkMessage(row.channel, row.serverFrom, row.payload))
            }
            lastId = after
            if (Duration.between(lastPresence, now) >= PRESENCE) {
                lastPresence = now
                val since = now.minus(SERVER_WINDOW)
                val self = serverName()
                remotePlayers = table.online(since)
                    .filterNot { it.server.equals(self, ignoreCase = true) }
                    .associate { it.id to NetworkPlayer(it.id, it.name, it.server) }
                servers = table.servers(since)
            }
            if (Duration.between(lastPurge, now) >= PURGE) {
                lastPurge = now
                table.purge(now.minus(KEEP))
            }
        } catch (e: Exception) {
            logger.warning("[Artisan] network: database round failed, retried: ${e.message}")
        }
    }

    /** This server's players are exactly [online] (every [PRESENCE_REWRITE], and at start). */
    fun writeOnline(online: Collection<NetworkPlayerRow>) {
        val table = rows() ?: return
        runCatching { table.replace(serverName(), online, clock.instant()) }
            .onFailure { logger.warning("[Artisan] network: players not written: ${it.message}") }
    }

    fun joined(player: NetworkPlayerRow) {
        val table = rows() ?: return
        runCatching { table.join(player, clock.instant()) }
            .onFailure { logger.warning("[Artisan] network: join of ${player.name} not written: ${it.message}") }
    }

    fun quit(id: UUID) {
        val table = rows() ?: return
        runCatching { table.quit(id, serverName()) }
            .onFailure { logger.warning("[Artisan] network: quit not written: ${it.message}") }
    }

    /** Runs this server's subscribers of [channel], on the caller's thread. */
    fun deliverHere(channel: String, payload: String) = deliver(NetworkMessage(channel, serverName(), payload))

    private fun deliver(message: NetworkMessage) {
        subscriptions[message.channel]?.forEach {
            try {
                it.handler.handle(message)
            } catch (e: Exception) {
                logger.log(Level.WARNING, "[Artisan] network: a handler of ${message.channel} failed", e)
            } catch (e: LinkageError) {
                logger.log(Level.WARNING, "[Artisan] network: a handler of ${message.channel} belongs to an unloaded plugin", e)
            }
        }
    }

    companion object {
        val POLL: Duration = Duration.ofMillis(100)
        val PRESENCE: Duration = Duration.ofSeconds(1)
        val PRESENCE_REWRITE: Duration = Duration.ofSeconds(30)
        val PURGE: Duration = Duration.ofSeconds(30)
        /** A message older than this is purged, and one waiting this long for the database is dropped. */
        val KEEP: Duration = Duration.ofMinutes(1)
        /** A server not seen for this long has no players (its presence beats every minute). */
        val SERVER_WINDOW: Duration = Duration.ofMinutes(3)
        const val MAX_WAITING = 10_000
        const val MAX_PAYLOAD = 60_000

        private val CHANNEL = Regex("^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$")

        fun requireChannel(channel: String) =
            require(channel.length <= 128 && CHANNEL.matches(channel)) { "Network channel '$channel': expected module:name in lower case" }
    }
}
