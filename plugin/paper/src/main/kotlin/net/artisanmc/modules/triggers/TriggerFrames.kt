package net.artisanmc.modules.triggers

import net.artisanmc.modules.api.gameevent.GameEventFrame

/**
 * The Game events whose Trigger chains are running on this thread, innermost last. A chain runs
 * inline in the event's listener (ADR `triggers-and-variables` §8), so `cancel_event` and
 * `set_event` find their event here; outside a Trigger (a menu click, a deferred chain) the stack
 * is empty and they have nothing to change.
 */
internal object TriggerFrames {
    private val stack = ThreadLocal.withInitial { ArrayDeque<GameEventFrame>() }

    val depth: Int get() = stack.get().size

    fun current(): GameEventFrame? = stack.get().lastOrNull()

    fun <T> with(frame: GameEventFrame, block: () -> T): T {
        val frames = stack.get()
        frames.addLast(frame)
        try {
            return block()
        } finally {
            frames.removeLast()
        }
    }
}
