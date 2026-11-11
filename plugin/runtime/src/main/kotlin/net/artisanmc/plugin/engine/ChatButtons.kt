package net.artisanmc.plugin.engine

import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import net.artisanmc.plugin.platform.Chat
import net.artisanmc.plugin.text.LenientText
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.event.ClickEvent
import org.bukkit.entity.Player

/**
 * `chat_button` (ADR `triggers-and-variables` §7): a chat line whose button runs a chain, for the
 * player it was sent to only, a bounded number of times and for a bounded time. The button carries
 * a random token, consumed by `/artisan click <token>` (no permission, absent from completion); a
 * token that is unknown, expired, used up or presented by another player does nothing. Tokens live
 * in memory: a restart forgets them.
 *
 * The chain runs with the bindings of the moment the button was sent (`event` included), on the
 * clicking player's thread. A Trigger's effects (`cancel_event`, `set_event`) have no event there:
 * they warn and do nothing.
 */
object ChatButtons {
    const val COMMAND = "/artisan:artisan click "
    private const val MAX_PER_PLAYER = 64

    private class Pending(
        val player: UUID,
        val ctx: ExecutionContext,
        val chain: Any?,
        var usesLeft: Int,
        val expiresAt: Long,
        val sentAt: Long,
    )

    private val pending = ConcurrentHashMap<String, Pending>()
    private val random = SecureRandom()

    /** The executor of the running engine, rebound at each reload; the one that sent the button otherwise. */
    @Volatile
    var executor: ActionExecutor? = null

    @Volatile
    var clock: () -> Long = System::currentTimeMillis

    fun send(ctx: ExecutionContext, args: Map<String, Any>, rt: EngineRuntime): ExecutionContext {
        val uses = Args.int(args, "uses", 1)
        val seconds = Args.int(args, "expires_seconds", 300)
        if (uses < 1 || seconds < 1) {
            rt.warn("chat_button: `uses` and `expires_seconds` must be at least 1 — skipped")
            return ctx
        }
        val token = issue(ctx, args["do"], uses, seconds)
        if (executor == null) executor = rt.executor
        val label = LenientText.parse(rt.text(ctx, args, "label"))
            .clickEvent(ClickEvent.runCommand(COMMAND + token))
        val text = args["text"]?.let { LenientText.parse(rt.text(ctx, args, "text")) }
        Chat.send(ctx.player, if (text == null) label else Component.text().append(text).append(Component.space()).append(label).build())
        return ctx
    }

    /** A new token for [ctx]'s player; the oldest of theirs is dropped past [MAX_PER_PLAYER]. */
    fun issue(ctx: ExecutionContext, chain: Any?, uses: Int, seconds: Int): String {
        prune()
        val now = clock()
        val owner = ctx.player.uniqueId
        val mine = pending.entries.filter { it.value.player == owner }
        if (mine.size >= MAX_PER_PLAYER) mine.minByOrNull { it.value.sentAt }?.let { pending.remove(it.key) }
        val bytes = ByteArray(12).also(random::nextBytes)
        val token = bytes.joinToString("") { "%02x".format(it) }
        pending[token] = Pending(owner, ctx, chain, uses, now + seconds * 1000L, now)
        return token
    }

    /**
     * [player] clicked [token]: the chain to run with its context, or null (unknown, expired, used
     * up, another player's). A use is spent here, before the chain runs.
     */
    fun consume(player: Player, token: String): Pair<ExecutionContext, Any?>? {
        val now = clock()
        var hit: Pending? = null
        pending.computeIfPresent(token) { _, p ->
            when {
                p.expiresAt <= now -> null
                p.player != player.uniqueId -> p
                else -> {
                    hit = p
                    p.usesLeft -= 1
                    if (p.usesLeft <= 0) null else p
                }
            }
        }
        val p = hit ?: return null
        return p.ctx.copy(player = player) to p.chain
    }

    /** Runs the chain of [token] for [player], on the thread that owns them; false when nothing ran. */
    fun click(player: Player, token: String): Boolean {
        val (ctx, chain) = consume(player, token.trim().lowercase()) ?: return false
        val ex = executor ?: return false
        val steps = runCatching { ActionChainCompiler.compile(chain) }.getOrElse {
            org.bukkit.Bukkit.getLogger().warning("[Artisan] chat_button: its `do` failed to parse: ${it.message}")
            return false
        }
        ex.executeSteps(steps, ctx)
        return true
    }

    private fun prune() {
        val now = clock()
        pending.values.removeIf { it.expiresAt <= now }
    }

    fun clear() = pending.clear()
}
