package net.artisanmc.plugin.scene

import net.artisanmc.modules.api.scene.SceneElement
import java.util.UUID

/**
 * Where a scene stands, as the engine keeps it: no Bukkit object to compare, the backend
 * resolves [ref] (the anchor entity) itself.
 */
sealed interface Anchor {
    val worldId: UUID

    data class Point(override val worldId: UUID, val x: Double, val y: Double, val z: Double) : Anchor

    /** [ref] is the entity object, held for the backend; [entityId] is what the engine compares. */
    class OnEntity(override val worldId: UUID, val entityId: UUID, val height: Double, val ref: Any) : Anchor {
        override fun equals(other: Any?) =
            other is OnEntity && other.entityId == entityId && other.height == height
        override fun hashCode() = entityId.hashCode() * 31 + height.hashCode()
    }
}

/**
 * What draws the elements: one entity (or later one packet-only id) per element and viewer.
 * Every call returns at once; the backend moves to the thread that owns the entity itself and
 * copes with a [remove] that comes before its [spawn] ran.
 */
interface DisplayBackend {
    /** A handle the engine gives back to [update] and [remove]. */
    fun spawn(viewer: UUID, anchor: Anchor, element: SceneElement): Any

    /** [element] replaces what [handle] draws, keeping its entity; its transform moves over [transitionTicks]. */
    fun update(handle: Any, element: SceneElement, transitionTicks: Int)

    fun remove(handle: Any)
}

/**
 * Who sees which scene, and the diff between two shows of one scene: an element keeps its
 * handle while its key and type stay, a key that goes is removed, a new one spawned, a new
 * anchor respawns everything. Every way a scene ends goes through [end], so no handle is ever
 * forgotten: the backend's entities live exactly as long as their scene here.
 *
 * Pure (no Bukkit): `PaperScenes` turns the API's anchors into [Anchor] and listens to the
 * events that end scenes. Thread-safe: every method holds the book's lock, and the backend's
 * calls only schedule.
 */
class SceneBook(private val backend: DisplayBackend) {

    private class Shown(val anchor: Anchor, val elements: Map<String, Pair<SceneElement, Any>>)

    private val viewers = HashMap<UUID, LinkedHashMap<String, Shown>>()

    @Synchronized
    fun show(viewer: UUID, scene: String, anchor: Anchor, elements: List<SceneElement>, transitionTicks: Int) {
        val keys = elements.map { it.key() }
        require(keys.toSet().size == keys.size) { "duplicate element key in scene $scene: $keys" }
        val scenes = viewers.getOrPut(viewer) { LinkedHashMap() }
        val before = scenes[scene]
        if (before != null && before.anchor != anchor) {
            end(before)
            scenes.remove(scene)
        }
        val old = scenes[scene]?.elements ?: emptyMap()
        val next = LinkedHashMap<String, Pair<SceneElement, Any>>()
        for (element in elements) {
            val kept = old[element.key()]
            next[element.key()] = when {
                kept == null -> element to backend.spawn(viewer, anchor, element)
                kept.first.javaClass != element.javaClass -> {
                    backend.remove(kept.second)
                    element to backend.spawn(viewer, anchor, element)
                }
                kept.first == element -> kept
                else -> {
                    backend.update(kept.second, element, transitionTicks)
                    element to kept.second
                }
            }
        }
        old.filterKeys { it !in next }.values.forEach { backend.remove(it.second) }
        scenes[scene] = Shown(anchor, next)
    }

    @Synchronized
    fun hide(viewer: UUID, scene: String) {
        val scenes = viewers[viewer] ?: return
        scenes.remove(scene)?.let(::end)
        if (scenes.isEmpty()) viewers.remove(viewer)
    }

    @Synchronized
    fun isShown(viewer: UUID, scene: String): Boolean = viewers[viewer]?.containsKey(scene) == true

    @Synchronized
    fun scenesOf(viewer: UUID): List<String> = viewers[viewer]?.keys?.toList() ?: emptyList()

    /** The viewer quit: all their scenes end. */
    @Synchronized
    fun endViewer(viewer: UUID): Int = removeWhere { v, _, _ -> v == viewer }

    /** The viewer is now in [worldId]: their scenes of other worlds end. */
    @Synchronized
    fun endOutsideWorld(viewer: UUID, worldId: UUID): Int =
        removeWhere { v, _, shown -> v == viewer && shown.anchor.worldId != worldId }

    /** The anchor entity left its world: every scene on it ends, whoever sees it. */
    @Synchronized
    fun endAnchor(entityId: UUID): Int =
        removeWhere { _, _, shown -> (shown.anchor as? Anchor.OnEntity)?.entityId == entityId }

    /** A module's plugin disables: the scenes named `<namespace>:…` end. */
    @Synchronized
    fun endNamespace(namespace: String): Int =
        removeWhere { _, scene, _ -> scene.substringBefore(':', "") == namespace }

    /** Artisan stops: every scene ends. */
    @Synchronized
    fun endAll(): Int = removeWhere { _, _, _ -> true }

    /** Whether an entity anchors a scene: the backend's follow loop stops when none does. */
    @Synchronized
    fun anchors(entityId: UUID): Boolean = viewers.values.any { scenes ->
        scenes.values.any { (it.anchor as? Anchor.OnEntity)?.entityId == entityId }
    }

    private fun removeWhere(match: (UUID, String, Shown) -> Boolean): Int {
        var ended = 0
        val viewerIt = viewers.entries.iterator()
        while (viewerIt.hasNext()) {
            val (viewer, scenes) = viewerIt.next()
            val it = scenes.entries.iterator()
            while (it.hasNext()) {
                val (scene, shown) = it.next()
                if (!match(viewer, scene, shown)) continue
                end(shown)
                it.remove()
                ended++
            }
            if (scenes.isEmpty()) viewerIt.remove()
        }
        return ended
    }

    private fun end(shown: Shown) {
        shown.elements.values.forEach { runCatching { backend.remove(it.second) } }
    }
}
