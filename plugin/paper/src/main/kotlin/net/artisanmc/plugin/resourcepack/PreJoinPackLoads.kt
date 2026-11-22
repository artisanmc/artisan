package net.artisanmc.plugin.resourcepack

import io.netty.channel.Channel
import io.netty.channel.ChannelHandlerContext
import io.netty.channel.ChannelInboundHandlerAdapter
import io.netty.util.AttributeKey
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import java.lang.reflect.Method
import java.lang.reflect.Proxy
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.logging.Level
import java.util.logging.Logger

/**
 * A pack the client loaded before joining: a host plugin (Nexo `send_pre_join`, any sender in
 * the configuration phase) sends it before the player exists, and Paper fires
 * `PlayerResourcePackStatusEvent` only in game, so [PackLoadTracker] never heard of it and
 * `has_resource_pack` stayed false for everyone.
 *
 * Each new connection gets an inbound handler ([Handler], through Paper's
 * `ChannelInitializeListenerHolder`) that keeps, on the channel, the id of the last pack the
 * client answered `SUCCESSFULLY_LOADED` to, whatever the phase. At join the tracker takes it
 * over ([PackLoadTracker.loadedBeforeJoin]), with the same rule as the event: any pack when
 * delegated, only Artisan's when it sends the pack itself.
 *
 * The packet is read by name (`ServerboundResourcePackPacket`, its `id()` and `action()`), the
 * server's own classes: a server without them, or without the holder, keeps the event alone.
 */
class PreJoinPackLoads(
    private val tracker: PackLoadTracker,
    private val channelOf: (Player) -> Channel?,
    private val logger: Logger,
) : Listener {

    private var installed = false

    /** Adds the handler to every connection opened from now on; false when the server has no holder. */
    fun install(loader: ClassLoader): Boolean {
        installed = runCatching {
            val holder = Class.forName(HOLDER, true, loader)
            val listenerType = Class.forName(LISTENER, true, loader)
            val listener = Proxy.newProxyInstance(listenerType.classLoader, arrayOf(listenerType)) { proxy, method, args ->
                when (method.name) {
                    "afterInitChannel" -> { attach(args[0] as Channel); null }
                    "hashCode" -> System.identityHashCode(proxy)
                    "equals" -> proxy === args?.get(0)
                    "toString" -> "Artisan pre-join pack loads"
                    else -> null
                }
            }
            holder.getMethod("addListener", net.kyori.adventure.key.Key::class.java, listenerType).invoke(null, KEY, listener)
            true
        }.onFailure {
            logger.log(Level.WARNING, "[Artisan] [resource-pack] cannot watch packs loaded before join (pre-join packs will not count for has_resource_pack)", it)
        }.getOrDefault(false)
        return installed
    }

    fun uninstall(loader: ClassLoader) {
        if (!installed) return
        runCatching {
            Class.forName(HOLDER, true, loader).getMethod("removeListener", net.kyori.adventure.key.Key::class.java).invoke(null, KEY)
        }
        installed = false
    }

    @EventHandler(priority = EventPriority.LOWEST)
    fun onJoin(event: PlayerJoinEvent) {
        val channel = runCatching { channelOf(event.player) }.getOrNull() ?: return
        val packId = channel.attr(LOADED).get() ?: return
        tracker.loadedBeforeJoin(event.player.uniqueId, packId)
    }

    companion object {
        private const val HOLDER = "io.papermc.paper.network.ChannelInitializeListenerHolder"
        private const val LISTENER = "io.papermc.paper.network.ChannelInitializeListener"
        private val KEY = net.kyori.adventure.key.Key.key("artisan", "pack_loads")
        const val HANDLER = "artisan_pack_loads"
        private const val PACKET = "ServerboundResourcePackPacket"
        private const val LOADED_ACTION = "SUCCESSFULLY_LOADED"

        /** The id of the last pack loaded on this connection. */
        val LOADED: AttributeKey<UUID> = AttributeKey.valueOf("artisan_pack_loaded")

        /** Before `packet_handler` (the decoded packets reach it there), else last. */
        fun attach(channel: Channel) {
            val pipeline = channel.pipeline()
            if (pipeline.get(HANDLER) != null) return
            runCatching {
                if (pipeline.get("packet_handler") != null) pipeline.addBefore("packet_handler", HANDLER, Handler())
                else pipeline.addLast(HANDLER, Handler())
            }
        }

        private val accessors = ConcurrentHashMap<Class<*>, Pair<Method, Method>?>()
        private val failureLogged = AtomicBoolean(false)

        /** The pack id when [packet] says a pack loaded, else null. */
        internal fun loadedPack(packet: Any): UUID? {
            val type = packet.javaClass
            if (type.simpleName != PACKET) return null
            val (id, action) = accessors.computeIfAbsent(type) {
                runCatching { it.getMethod("id") to it.getMethod("action") }.getOrNull()
            } ?: return null
            if ((action.invoke(packet) as? Enum<*>)?.name != LOADED_ACTION) return null
            return id.invoke(packet) as? UUID
        }
    }

    /** Notes each pack the client loaded; every packet goes on unchanged. */
    class Handler : ChannelInboundHandlerAdapter() {
        override fun channelRead(ctx: ChannelHandlerContext, msg: Any) {
            try {
                loadedPack(msg)?.let { ctx.channel().attr(LOADED).set(it) }
            } catch (e: Throwable) {
                if (failureLogged.compareAndSet(false, true)) {
                    Logger.getLogger("Artisan").log(Level.WARNING, "[Artisan] [resource-pack] cannot read a pack status packet (logged once)", e)
                }
            }
            ctx.fireChannelRead(msg)
        }
    }
}
