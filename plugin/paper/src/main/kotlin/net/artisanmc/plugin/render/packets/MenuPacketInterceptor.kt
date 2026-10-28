package net.artisanmc.plugin.render.packets

import io.netty.channel.Channel
import io.netty.channel.ChannelHandlerContext
import io.netty.channel.ChannelOutboundHandlerAdapter
import io.netty.channel.ChannelPromise
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerJoinEvent
import org.bukkit.event.player.PlayerQuitEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.logging.Level
import java.util.logging.Logger

/**
 * Puts [MenuPacketRewriter] in each player's connection, replacing PacketEvents.
 *
 * One outbound handler per channel, right after `encoder` (towards the tail): outgoing
 * packets cross it as the server's objects, already out of their bundles (`unbundler`
 * comes first on their way), and before any byte is written. ViaVersion places its own
 * encoder before `encoder` and translates the bytes that come out of it: it sees the
 * rewritten packet, never the reverse.
 *
 * Injected at join ([EventPriority.LOWEST]: before any plugin opens a menu there) and for
 * the players already online on enable; removed on disable. A failure while rewriting
 * lets the original packet through and is logged once: a broken menu, never a broken
 * connection.
 */
class MenuPacketInterceptor(
    private val channelOf: (Player) -> Channel?,
    private val rewriter: MenuPacketRewriter,
    private val logger: Logger,
) : Listener, SilentSender {

    private val contexts = ConcurrentHashMap<UUID, ChannelHandlerContext>()
    private val failureLogged = AtomicBoolean(false)

    @EventHandler(priority = EventPriority.LOWEST)
    fun onJoin(event: PlayerJoinEvent) = inject(event.player)

    @EventHandler(priority = EventPriority.MONITOR)
    fun onQuit(event: PlayerQuitEvent) {
        contexts.remove(event.player.uniqueId)
    }

    fun inject(player: Player) {
        val channel = runCatching { channelOf(player) }
            .onFailure { logOnce("cannot reach ${player.name}'s connection", it) }
            .getOrNull() ?: return
        val handler = Handler(player.uniqueId)
        val pipeline = channel.pipeline()
        runCatching {
            if (pipeline.get(HANDLER) != null) pipeline.remove(HANDLER)
            if (pipeline.get(ENCODER) != null) pipeline.addAfter(ENCODER, HANDLER, handler)
            else pipeline.addBefore(PACKET_HANDLER, HANDLER, handler)
        }.onFailure { logOnce("cannot inject into ${player.name}'s connection", it) }
    }

    /** Removes the handler from every channel it is in (plugin disable). */
    fun uninjectAll() {
        contexts.values.forEach { ctx -> runCatching { ctx.channel().pipeline().remove(HANDLER) } }
        contexts.clear()
    }

    /** Written from our handler's place: the packets after it see it, ours do not. */
    override fun send(player: Player, packet: Any) {
        val ctx = contexts[player.uniqueId] ?: return
        if (ctx.executor().inEventLoop()) ctx.writeAndFlush(packet)
        else ctx.executor().execute { ctx.writeAndFlush(packet) }
    }

    private fun logOnce(message: String, error: Throwable) {
        if (failureLogged.compareAndSet(false, true)) {
            logger.log(Level.SEVERE, "[Artisan] menu packets: $message — menus may show the server's contents (logged once)", error)
        }
    }

    private inner class Handler(private val playerId: UUID) : ChannelOutboundHandlerAdapter() {
        override fun handlerAdded(ctx: ChannelHandlerContext) {
            contexts[playerId] = ctx
        }

        override fun handlerRemoved(ctx: ChannelHandlerContext) {
            contexts.remove(playerId, ctx)
        }

        override fun write(ctx: ChannelHandlerContext, msg: Any, promise: ChannelPromise) {
            val out = try {
                rewriter.rewrite(playerId, msg)
            } catch (e: Exception) {
                logOnce("rewriting ${msg.javaClass.simpleName} failed", e)
                msg
            }
            ctx.write(out, promise)
        }
    }

    companion object {
        const val HANDLER = "artisan_menus"
        private const val ENCODER = "encoder"
        private const val PACKET_HANDLER = "packet_handler"
    }
}
