package net.artisanmc.plugin.scene

import com.destroystokyo.paper.event.entity.EntityRemoveFromWorldEvent
import net.artisanmc.modules.api.scene.SceneAnchor
import net.artisanmc.modules.api.scene.SceneElement
import net.artisanmc.modules.api.scene.ScenesApi
import org.bukkit.entity.Entity
import org.bukkit.entity.Player
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.Listener
import org.bukkit.event.player.PlayerChangedWorldEvent
import org.bukkit.event.player.PlayerQuitEvent

/**
 * `api.getScenes()`: checks a call, turns its anchor into the engine's and ends scenes on the
 * events that make them pointless (quit, change of world, anchor gone). The scenes of a module
 * end with its plugin ([endModule], from Artisan's add-on release) and all of them with Artisan
 * ([endAll], from onDisable).
 */
class PaperScenes(
    private val book: SceneBook,
    private val isBedrock: (Player) -> Boolean,
) : ScenesApi, Listener {

    override fun support(viewer: Player): ScenesApi.Support =
        if (isBedrock(viewer)) ScenesApi.Support.TEXT_ONLY else ScenesApi.Support.FULL

    override fun show(viewer: Player, scene: String, anchor: SceneAnchor, elements: List<SceneElement>, transitionTicks: Int) {
        require(NAME.matches(scene)) { "scene name must be <module>:<name> ([a-z0-9_.-]): $scene" }
        require(elements.size <= ScenesApi.MAX_ELEMENTS) { "scene $scene has ${elements.size} elements, at most ${ScenesApi.MAX_ELEMENTS}" }
        require(transitionTicks in 0..MAX_TRANSITION) { "transitionTicks must be 0..$MAX_TRANSITION: $transitionTicks" }
        if (!viewer.isOnline) return
        book.show(viewer.uniqueId, scene, anchorOf(anchor), drawable(support(viewer), elements), transitionTicks)
    }

    override fun hide(viewer: Player, scene: String) = book.hide(viewer.uniqueId, scene)

    override fun isShown(viewer: Player, scene: String): Boolean = book.isShown(viewer.uniqueId, scene)

    override fun aimed(viewer: Player, scene: String): String? {
        val (anchor, hitboxes) = book.hitboxes(viewer.uniqueId, scene) ?: return null
        if (hitboxes.isEmpty() || anchor.worldId != viewer.world.uid) return null
        val base = when (anchor) {
            is Anchor.Point -> ScenePick.Vec(anchor.x, anchor.y, anchor.z)
            is Anchor.OnEntity -> (anchor.ref as Entity).takeIf { it.isValid }?.location
                ?.let { ScenePick.Vec(it.x, it.y + anchor.height, it.z) } ?: return null
        }
        val eye = viewer.eyeLocation
        val dir = eye.direction
        return ScenePick.aimed(
            base, hitboxes, ScenePick.Vec(eye.x, eye.y, eye.z), ScenePick.Vec(dir.x, dir.y, dir.z), ScenesApi.AIM_RANGE,
        )
    }

    fun endModule(moduleId: String): Int = book.endNamespace(moduleId)

    fun endAll(): Int = book.endAll()

    @EventHandler(priority = EventPriority.MONITOR)
    fun onQuit(event: PlayerQuitEvent) {
        book.endViewer(event.player.uniqueId)
    }

    @EventHandler(priority = EventPriority.MONITOR)
    fun onChangedWorld(event: PlayerChangedWorldEvent) {
        book.endOutsideWorld(event.player.uniqueId, event.player.world.uid)
    }

    @EventHandler(priority = EventPriority.MONITOR)
    fun onRemoveFromWorld(event: EntityRemoveFromWorldEvent) {
        val id = event.entity.uniqueId
        if (book.anchors(id)) book.endAnchor(id)
    }

    companion object {
        const val MAX_TRANSITION = 200
        private val NAME = Regex("[a-z0-9_.-]+:[a-z0-9_./-]+")

        /** What [support] draws of [elements]: a Bedrock client (Geyser) only shows text displays. */
        internal fun drawable(support: ScenesApi.Support, elements: List<SceneElement>): List<SceneElement> = when (support) {
            ScenesApi.Support.FULL -> elements
            // A hitbox draws nothing: the server aims for every client.
            ScenesApi.Support.TEXT_ONLY -> elements.filter { it is SceneElement.Text || it is SceneElement.Hitbox }
            ScenesApi.Support.NONE -> emptyList()
        }

        internal fun anchorOf(anchor: SceneAnchor): Anchor = when (anchor) {
            is SceneAnchor.Point -> anchor.location().let { Anchor.Point(it.world.uid, it.x, it.y, it.z) }
            is SceneAnchor.OnEntity -> anchor.entity().let { Anchor.OnEntity(it.world.uid, it.uniqueId, anchor.height(), it) }
        }
    }
}
