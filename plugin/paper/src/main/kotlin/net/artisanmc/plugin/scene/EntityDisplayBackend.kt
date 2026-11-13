package net.artisanmc.plugin.scene

import net.artisanmc.modules.api.scene.SceneElement
import net.artisanmc.modules.api.scene.SceneTransform
import net.artisanmc.plugin.scheduling.EntityScheduling
import net.artisanmc.plugin.scheduling.Scheduler
import net.artisanmc.plugin.text.LenientText
import org.bukkit.Color
import org.bukkit.Location
import org.bukkit.NamespacedKey
import org.bukkit.entity.BlockDisplay
import org.bukkit.entity.Display
import org.bukkit.entity.Entity
import org.bukkit.entity.ItemDisplay
import org.bukkit.entity.TextDisplay
import org.bukkit.event.EventHandler
import org.bukkit.event.Listener
import org.bukkit.event.world.EntitiesLoadEvent
import org.bukkit.persistence.PersistentDataType
import org.bukkit.plugin.Plugin
import org.bukkit.util.Transformation
import org.joml.AxisAngle4f
import org.joml.Vector3f
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Draws scene elements with Paper's display entities: one per element and viewer, spawned
 * hidden from everyone ([Entity.setVisibleByDefault] false) then shown to the viewer alone
 * ([org.bukkit.entity.Player.showEntity]). No packet library.
 *
 * An entity is never saved ([Entity.setPersistent] false: a crash leaves nothing in the world)
 * and carries the [TAG] key, by which [onEntitiesLoad] removes any that would come back anyway
 * (a chunk saved by another plugin's hand, an older Artisan). An entity follows an anchor
 * entity by teleports, interpolated by the client over [FOLLOW_TICKS], never as a passenger:
 * an entity carrying passengers refuses Bukkit's `teleport`, which would break the NPC plugin
 * or the player it rides.
 *
 * Every entity call runs on the thread that owns the entity or the anchor (Folia, Leaf).
 */
class EntityDisplayBackend(
    private val plugin: Plugin,
    private val scheduler: Scheduler,
    /** Called when an anchor entity is found gone: the book ends its scenes. */
    private val onAnchorGone: (UUID) -> Unit,
) : DisplayBackend, Listener {

    private val tag = NamespacedKey(plugin, TAG)

    private inner class Handle(val viewer: UUID, val anchor: Anchor, @Volatile var element: SceneElement) {
        @Volatile var entity: Display? = null
        @Volatile var removed = false
        @Volatile var transition = 0
    }

    private val live = ConcurrentHashMap.newKeySet<Handle>()
    /** The handles that follow each anchor entity, by its id. */
    private val followers = ConcurrentHashMap<UUID, MutableSet<Handle>>()

    override fun spawn(viewer: UUID, anchor: Anchor, element: SceneElement): Any {
        val handle = Handle(viewer, anchor, element)
        live += handle
        onAnchorThread(anchor) {
            if (handle.removed) return@onAnchorThread
            val at = location(anchor) ?: return@onAnchorThread onAnchorGone((anchor as Anchor.OnEntity).entityId)
            val display = synchronized(handle) {
                at.world.spawn(at, typeOf(handle.element)) { d ->
                    d.isPersistent = false
                    d.isVisibleByDefault = false
                    d.persistentDataContainer.set(tag, PersistentDataType.STRING, viewer.toString())
                    d.teleportDuration = FOLLOW_TICKS
                    apply(d, handle.element, 0)
                }.also { handle.entity = it }
            }
            if (handle.removed) {
                display.remove()
                return@onAnchorThread
            }
            // The viewer tracks the anchor's surroundings: on Folia they share its region.
            plugin.server.getPlayer(viewer)?.showEntity(plugin, display)
            if (anchor is Anchor.OnEntity) follow(anchor, handle)
        }
        return handle
    }

    override fun update(handle: Any, element: SceneElement, transitionTicks: Int) {
        val h = handle as Handle
        val display = synchronized(h) {
            h.element = element
            h.transition = transitionTicks
            h.entity
        } ?: return // the spawn to come reads h.element
        onEntityThread(display) {
            if (!h.removed && display.isValid) apply(display, h.element, h.transition)
        }
    }

    override fun remove(handle: Any) {
        val h = handle as Handle
        if (h.removed) return
        h.removed = true
        live -= h
        (h.anchor as? Anchor.OnEntity)?.let { followers[it.entityId]?.remove(h) }
        val display = h.entity ?: return
        onEntityThread(display) { display.remove() }
    }

    /**
     * Artisan stops: removes every entity now, on this thread (no task can be scheduled any more).
     * On Folia a removal off the entity's thread fails: the entity is not persistent, the stop
     * that follows drops it.
     */
    fun removeAllNow() {
        live.forEach { h ->
            h.removed = true
            runCatching { h.entity?.remove() }
        }
        live.clear()
        followers.clear()
    }

    /** Leftovers: a tagged display that no live handle owns. */
    @EventHandler
    fun onEntitiesLoad(event: EntitiesLoadEvent) {
        val owned = live.mapNotNullTo(HashSet()) { it.entity?.uniqueId }
        event.entities.forEach {
            if (it is Display && it.persistentDataContainer.has(tag) && it.uniqueId !in owned) it.remove()
        }
    }

    private fun follow(anchor: Anchor.OnEntity, handle: Handle) {
        var started = false
        followers.compute(anchor.entityId) { _, set ->
            (set ?: ConcurrentHashMap.newKeySet<Handle>().also { started = true }).apply { add(handle) }
        }
        if (started) followLoop(anchor)
    }

    /** Every tick on the anchor's thread while a handle follows it: moves those that are behind. */
    private fun followLoop(anchor: Anchor.OnEntity) {
        val entity = anchor.ref as Entity
        val entities = scheduler as? EntityScheduling ?: return
        entities.entity(entity, 1, onGone = { stopFollowing(anchor.entityId, gone = true) }) {
            val handles = followers[anchor.entityId]
            if (handles.isNullOrEmpty()) {
                followers.remove(anchor.entityId, handles)
                return@entity
            }
            if (!entity.isValid) return@entity stopFollowing(anchor.entityId, gone = true)
            val to = entity.location.add(0.0, anchor.height, 0.0)
            to.yaw = 0f
            to.pitch = 0f
            for (h in handles) {
                val display = h.entity ?: continue
                if (!display.isValid || display.world != to.world) continue
                if (display.location.distanceSquared(to) > EPSILON && plugin.server.isOwnedByCurrentRegion(display)) {
                    display.teleportAsync(to)
                }
            }
            followLoop(anchor)
        }
    }

    private fun stopFollowing(entityId: UUID, gone: Boolean) {
        followers.remove(entityId)
        if (gone) onAnchorGone(entityId)
    }

    private fun location(anchor: Anchor): Location? = when (anchor) {
        is Anchor.Point -> plugin.server.getWorld(anchor.worldId)?.let { Location(it, anchor.x, anchor.y, anchor.z) }
        is Anchor.OnEntity -> (anchor.ref as Entity).takeIf { it.isValid }?.location
            ?.add(0.0, anchor.height, 0.0)?.apply { yaw = 0f; pitch = 0f }
    }

    private fun onAnchorThread(anchor: Anchor, task: () -> Unit) {
        when (anchor) {
            is Anchor.Point -> scheduler.region(
                anchor.worldId, anchor.x.toInt() shr 4, anchor.z.toInt() shr 4, 0, task,
            )
            is Anchor.OnEntity -> (scheduler as? EntityScheduling)
                ?.entity(anchor.ref as Entity, 0, onGone = { onAnchorGone(anchor.entityId) }, task = task)
                ?: scheduler.global(task)
        }
    }

    private fun onEntityThread(entity: Entity, task: () -> Unit) {
        (scheduler as? EntityScheduling)?.entity(entity, 0, task = task) ?: scheduler.global(task)
    }

    companion object {
        const val TAG = "scene"
        /** Ticks the client takes to reach a followed anchor's new place. */
        const val FOLLOW_TICKS = 2
        private const val EPSILON = 0.0001

        private fun typeOf(element: SceneElement): Class<out Display> = when (element) {
            is SceneElement.Text -> TextDisplay::class.java
            is SceneElement.Item -> ItemDisplay::class.java
            is SceneElement.Block -> BlockDisplay::class.java
            is SceneElement.Hitbox -> error("a hitbox draws nothing: SceneBook never spawns one")
        }

        /** [element] onto [display]; its transform reached over [transitionTicks]. */
        internal fun apply(display: Display, element: SceneElement, transitionTicks: Int) {
            when (element) {
                is SceneElement.Text -> (display as TextDisplay).apply {
                    text(LenientText.parse(element.miniMessage()))
                    billboard = billboard(element.billboard())
                    lineWidth = element.lineWidth()
                    isShadowed = element.shadow()
                    if (element.background() == SceneElement.Text.DEFAULT_BACKGROUND) {
                        isDefaultBackground = true
                    } else {
                        isDefaultBackground = false
                        backgroundColor = Color.fromARGB(element.background())
                    }
                }
                is SceneElement.Item -> (display as ItemDisplay).apply {
                    setItemStack(element.item())
                    billboard = billboard(element.billboard())
                }
                is SceneElement.Block -> (display as BlockDisplay).block = element.block()
                is SceneElement.Hitbox -> return
            }
            val next = transformation(element.transform())
            if (display.transformation != next) {
                display.interpolationDelay = 0
                display.interpolationDuration = transitionTicks
                display.transformation = next
            }
        }

        internal fun transformation(t: SceneTransform) = Transformation(
            Vector3f(t.x().toFloat(), t.y().toFloat(), t.z().toFloat()),
            // Minecraft's yaw turns clockwise seen from above; a positive angle around +Y turns counter-clockwise.
            AxisAngle4f(Math.toRadians(-t.yaw().toDouble()).toFloat(), 0f, 1f, 0f),
            Vector3f(t.scale(), t.scale(), t.scale()),
            AxisAngle4f(),
        )

        private fun billboard(b: SceneElement.Billboard) = when (b) {
            SceneElement.Billboard.FIXED -> Display.Billboard.FIXED
            SceneElement.Billboard.VERTICAL -> Display.Billboard.VERTICAL
            SceneElement.Billboard.CENTER -> Display.Billboard.CENTER
        }
    }
}
