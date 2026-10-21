package net.artisanmc.plugin.network

import net.artisanmc.modules.api.network.NetworkApi
import net.artisanmc.modules.api.network.NetworkLocation
import net.artisanmc.modules.api.network.NetworkMessageHandler
import net.artisanmc.modules.api.network.NetworkPlayer
import net.artisanmc.modules.api.network.NetworkPresence
import net.artisanmc.modules.api.network.NetworkServer
import net.artisanmc.modules.api.network.NetworkSubscription
import net.artisanmc.modules.api.network.TeleportResult
import net.artisanmc.modules.api.text.TextApi
import net.artisanmc.plugin.database.NetworkPlayerRow
import net.artisanmc.plugin.database.NetworkRows
import net.artisanmc.plugin.platform.ServerPlatform
import net.artisanmc.plugin.scheduling.Scheduler
import org.bukkit.Location
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

/**
 * `api.network` (design `reseau-artisan`): [NetworkBus] for channels and presence, Bukkit for the
 * players of this server and the teleports. One thread, `Artisan-network`, polls the database
 * and runs the handlers.
 */
internal class SuiteNetwork(
    private val plugin: Plugin,
    private val scheduler: Scheduler,
    private val text: TextApi,
    private val logger: Logger,
    shared: () -> Boolean,
    rows: () -> NetworkRows?,
) : NetworkApi, Listener {
    @Volatile private var name: String = ""
    /** Without a valid name, or on H2, the server stays alone: nothing is read or written. */
    private val bus = NetworkBus({ if (name.isEmpty() || !shared()) null else rows() }, { name.isNotEmpty() && shared() }, { name }, logger)
    private var executor: ScheduledExecutorService? = null
    /** Arrivals announced by the server a player leaves: placed on join, forgotten after [ARRIVAL_WINDOW]. */
    private val arrivals = ConcurrentHashMap<UUID, Pair<NetworkLocation, Long>>()
    private val joinedAt = ConcurrentHashMap<UUID, Long>()

    /** From `onEnable`, once the server's name is known (null: invalid `name`, the network stays local). */
    fun start(serverName: String?) {
        name = serverName.orEmpty()
        plugin.server.messenger.registerOutgoingPluginChannel(plugin, BUNGEE)
        plugin.server.pluginManager.registerEvents(this, plugin)
        bus.subscribe(null, MESSAGE_CHANNEL) { message ->
            val (id, body) = message.payload.split('\n', limit = 2).takeIf { it.size == 2 } ?: return@subscribe
            val player = runCatching { UUID.fromString(id) }.getOrNull()?.let(plugin.server::getPlayer) ?: return@subscribe
            text.send(player, body)
        }
        bus.subscribe(null, TELEPORT_CHANNEL) { message -> TeleportCodec.decode(message.payload)?.let(::arrival) }
        val thread = Executors.newSingleThreadScheduledExecutor { Thread(it, "Artisan-network").apply { isDaemon = true } }
        executor = thread
        thread.scheduleWithFixedDelay(bus::tick, 0, NetworkBus.POLL.toMillis(), TimeUnit.MILLISECONDS)
        thread.scheduleWithFixedDelay({ bus.writeOnline(localRows()) }, 1, NetworkBus.PRESENCE_REWRITE.seconds, TimeUnit.SECONDS)
    }

    fun stop() {
        executor?.let {
            it.shutdown()
            it.awaitTermination(2, TimeUnit.SECONDS)
        }
        executor = null
        bus.writeOnline(emptyList())
    }

    /** What a disabling plugin subscribed. */
    fun releaseLoadedBy(loader: ClassLoader): Int = bus.releaseLoadedBy(loader)

    override fun getServerName(): String = name

    override fun getServers(): List<NetworkServer> =
        bus.servers.map { NetworkServer(it, it.equals(name, ignoreCase = true)) }

    override fun subscribe(owner: Plugin, channel: String, handler: NetworkMessageHandler): NetworkSubscription {
        val cancel = bus.subscribe(owner.javaClass.classLoader, channel, handler)
        return NetworkSubscription { cancel() }
    }

    override fun publish(channel: String, payload: String, includeSelf: Boolean) {
        if (!includeSelf) return bus.publish(channel, payload, false)
        NetworkBus.requireChannel(channel)
        // Delivered here on the network thread, like a message from another server.
        bus.publish(channel, payload, false)
        val thread = executor
        if (thread == null) bus.deliverHere(channel, payload) else thread.execute { bus.deliverHere(channel, payload) }
    }

    override fun getPresence(): NetworkPresence = presence

    private val presence = object : NetworkPresence {
        override fun getPlayer(id: UUID): NetworkPlayer? =
            plugin.server.getPlayer(id)?.let { NetworkPlayer(it.uniqueId, it.name, name) } ?: bus.remotePlayers[id]

        override fun find(name: String): NetworkPlayer? =
            plugin.server.getPlayerExact(name)?.let { NetworkPlayer(it.uniqueId, it.name, this@SuiteNetwork.name) }
                ?: bus.remotePlayers.values.firstOrNull { it.name.equals(name, ignoreCase = true) }

        override fun getOnline(): Collection<NetworkPlayer> {
            val local = plugin.server.onlinePlayers.map { NetworkPlayer(it.uniqueId, it.name, name) }
            val here = local.map { it.id }.toSet()
            return local + bus.remotePlayers.values.filter { it.id !in here }
        }

        override fun sendMessage(id: UUID, miniMessage: String) {
            val local = plugin.server.getPlayer(id)
            if (local != null) text.send(local, miniMessage)
            else if (bus.remotePlayers.containsKey(id)) bus.publish(MESSAGE_CHANNEL, "$id\n$miniMessage", false)
        }
    }

    override fun teleport(player: Player, location: NetworkLocation, delaySeconds: Int): CompletableFuture<TeleportResult> {
        val here = location.server.isEmpty() || location.server.equals(name, ignoreCase = true)
        if (!here && !knows(location.server)) return CompletableFuture.completedFuture(TeleportResult.UNKNOWN_SERVER)
        if (here && plugin.server.getWorld(location.world) == null) return CompletableFuture.completedFuture(TeleportResult.UNKNOWN_WORLD)
        return afterDelay(player, delaySeconds) { target ->
            if (here) {
                val world = plugin.server.getWorld(location.world) ?: return@afterDelay TeleportResult.UNKNOWN_WORLD
                ServerPlatform.teleport(target, Location(world, location.x, location.y, location.z, location.yaw, location.pitch))
            } else {
                bus.publish(TELEPORT_CHANNEL, TeleportCodec.encode(target.uniqueId, location), false)
                // The arrival is announced before the switch: the other server reads it within a poll, the proxy takes longer.
                scheduler.playerLater(target.uniqueId, ARRIVAL_LEAD_TICKS) { plugin.server.getPlayer(target.uniqueId)?.let { sendTo(it, location.server) } }
            }
            TeleportResult.DONE
        }
    }

    override fun connect(player: Player, server: String, delaySeconds: Int): CompletableFuture<TeleportResult> {
        if (server.equals(name, ignoreCase = true)) return CompletableFuture.completedFuture(TeleportResult.DONE)
        if (!knows(server)) return CompletableFuture.completedFuture(TeleportResult.UNKNOWN_SERVER)
        return afterDelay(player, delaySeconds) { target ->
            sendTo(target, server)
            TeleportResult.DONE
        }
    }

    /** A server of the network, by the names `artisan_servers` holds (case kept as there, for the proxy). */
    private fun knows(server: String) = bus.servers.any { it.equals(server, ignoreCase = true) }

    /** Counts down on the player's thread, a check per second; moving a block or leaving cancels. */
    private fun afterDelay(player: Player, delaySeconds: Int, then: (Player) -> TeleportResult): CompletableFuture<TeleportResult> {
        val result = CompletableFuture<TeleportResult>()
        val id = player.uniqueId
        val start = player.location.let { Triple(it.blockX, it.blockY, it.blockZ) }
        fun check(left: Int) {
            val target = plugin.server.getPlayer(id)
            when {
                target == null -> result.complete(TeleportResult.OFFLINE)
                target.location.let { Triple(it.blockX, it.blockY, it.blockZ) } != start -> result.complete(TeleportResult.MOVED)
                left <= 0 -> result.complete(runCatching { then(target) }.getOrElse {
                    logger.warning("[Artisan] network: teleport of ${target.name} failed: ${it.message}")
                    TeleportResult.FAILED
                })
                else -> scheduler.playerLater(id, 20) { check(left - 1) }
            }
        }
        if (delaySeconds <= 0) scheduler.player(id, { result.complete(TeleportResult.OFFLINE) }) { check(0) }
        else scheduler.playerLater(id, 20) { check(delaySeconds - 1) }
        return result
    }

    private fun sendTo(player: Player, server: String) {
        val proxyName = bus.servers.firstOrNull { it.equals(server, ignoreCase = true) } ?: server
        val bytes = ByteArrayOutputStream().also { out ->
            DataOutputStream(out).use { it.writeUTF("Connect"); it.writeUTF(proxyName) }
        }.toByteArray()
        player.sendPluginMessage(plugin, BUNGEE, bytes)
    }

    /** A player announced by another server: placed now if already here, else when they join. */
    private fun arrival(request: TeleportCodec.Request) {
        if (!request.location.server.equals(name, ignoreCase = true)) return
        val now = System.currentTimeMillis()
        arrivals[request.player] = request.location to now
        val joined = joinedAt[request.player]
        if (joined != null && now - joined < ARRIVAL_WINDOW_MS) {
            scheduler.player(request.player, {}) { plugin.server.getPlayer(request.player)?.let(::place) }
        }
    }

    private fun place(player: Player) {
        val (location, at) = arrivals.remove(player.uniqueId) ?: return
        if (System.currentTimeMillis() - at > ARRIVAL_WINDOW_MS) return
        val world = plugin.server.getWorld(location.world)
        if (world == null) {
            logger.warning("[Artisan] network: ${player.name} arrived for world ${location.world}, which this server does not have")
            return
        }
        ServerPlatform.teleport(player, Location(world, location.x, location.y, location.z, location.yaw, location.pitch))
    }

    @EventHandler(priority = EventPriority.LOWEST)
    fun onJoin(event: PlayerJoinEvent) {
        val player = event.player
        joinedAt[player.uniqueId] = System.currentTimeMillis()
        place(player)
        val row = NetworkPlayerRow(player.uniqueId, player.name, name)
        executor?.execute { bus.joined(row) }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    fun onQuit(event: PlayerQuitEvent) {
        val id = event.player.uniqueId
        joinedAt.remove(id)
        arrivals.remove(id)
        executor?.execute { bus.quit(id) }
    }

    private fun localRows() = plugin.server.onlinePlayers.map { NetworkPlayerRow(it.uniqueId, it.name, name) }

    companion object {
        const val BUNGEE = "BungeeCord"
        const val MESSAGE_CHANNEL = "artisan:message"
        const val TELEPORT_CHANNEL = "artisan:teleport"
        /** Ticks between announcing an arrival and asking the proxy: two polls. */
        const val ARRIVAL_LEAD_TICKS = 4L
        const val ARRIVAL_WINDOW_MS = 30_000L
    }
}

/** The payload of `artisan:teleport`: one value per line. */
internal object TeleportCodec {
    data class Request(val player: UUID, val location: NetworkLocation)

    fun encode(player: UUID, l: NetworkLocation): String =
        listOf(player, l.server, l.world, l.x, l.y, l.z, l.yaw, l.pitch).joinToString("\n")

    fun decode(payload: String): Request? = runCatching {
        val p = payload.split('\n')
        require(p.size == 8)
        Request(UUID.fromString(p[0]), NetworkLocation(p[1], p[2], p[3].toDouble(), p[4].toDouble(), p[5].toDouble(), p[6].toFloat(), p[7].toFloat()))
    }.getOrNull()
}
