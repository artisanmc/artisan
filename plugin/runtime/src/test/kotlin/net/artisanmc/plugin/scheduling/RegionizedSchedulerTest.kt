package net.artisanmc.plugin.scheduling

import io.papermc.paper.threadedregions.scheduler.EntityScheduler
import io.papermc.paper.threadedregions.scheduler.ScheduledTask
import org.bukkit.Server
import org.bukkit.entity.Entity
import org.bukkit.plugin.Plugin
import java.lang.reflect.Proxy
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * `runFor` is called from async tasks (a module loads from SQL, then greets the player):
 * the entity must be reached without `Server.getEntity`, which Leaf and Folia refuse off
 * a tick thread ("Asynchronous Chunk getEntities call!").
 */
class RegionizedSchedulerTest {
    private inline fun <reified T> proxy(crossinline answer: (String, Array<Any?>) -> Any?): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, args ->
            answer(method.name, args ?: emptyArray())
        } as T

    private val server = proxy<Server> { name, _ ->
        if (name == "getEntity") throw IllegalStateException("Asynchronous Chunk getEntities call!")
        null
    }
    private val plugin = proxy<Plugin> { name, _ -> if (name == "getServer") server else null }

    private fun entityWith(scheduler: EntityScheduler?) =
        proxy<Entity> { name, _ -> if (name == "getScheduler") scheduler else null }

    @Test
    fun `runFor hands the task to the entity's own scheduler, without a world lookup`() {
        var ran = 0
        val scheduler = proxy<EntityScheduler> { name, args ->
            if (name == "run") {
                @Suppress("UNCHECKED_CAST")
                (args[1] as java.util.function.Consumer<Any?>).accept(null)
                proxy<ScheduledTask> { _, _ -> null }
            } else null
        }
        PortTaskScheduler(RegionizedScheduler(plugin)).runFor(entityWith(scheduler)) { ran++ }
        assertEquals(1, ran)
    }

    @Test
    fun `runForLater uses the delayed entity scheduler`() {
        val calls = mutableListOf<Pair<String, Long>>()
        val scheduler = proxy<EntityScheduler> { name, args ->
            if (name == "runDelayed") calls += name to (args[3] as Long)
            null
        }
        PortTaskScheduler(RegionizedScheduler(plugin)).runForLater(entityWith(scheduler), 40) {}
        assertEquals(listOf("runDelayed" to 40L), calls)
    }
}
