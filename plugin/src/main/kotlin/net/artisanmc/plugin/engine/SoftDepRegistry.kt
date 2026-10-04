package net.artisanmc.plugin.engine

import net.milkbowl.vault.economy.Economy
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import org.bukkit.plugin.java.JavaPlugin

class VaultProvider(private val economy: Economy) {
    fun balance(player: Player): Double = economy.getBalance(player)
    fun withdraw(player: Player, amount: Double): Boolean =
        economy.withdrawPlayer(player, amount).transactionSuccess()
    fun deposit(player: Player, amount: Double) { economy.depositPlayer(player, amount) }

    companion object {
        fun tryInit(plugin: JavaPlugin): VaultProvider? = runCatching {
            val reg = plugin.server.servicesManager
                .getRegistration(Economy::class.java) ?: return null
            VaultProvider(reg.provider)
        }.getOrNull()
    }
}

open class PapiProvider {
    open fun declaredPlaceholders(): PapiPlaceholderCatalog {
        val expansions = me.clip.placeholderapi.PlaceholderAPIPlugin.getInstance()
            .localExpansionManager.expansions
        return PapiPlaceholderCatalog.collect(expansions.map { expansion ->
            PapiExpansion(expansion.identifier) { expansion.placeholders }
        })
    }

    /**
     * Tolérant : une PlaceholderAPI installée mais **cassée** (ex. incompatibilité
     * de version Paper — son `<clinit>` jette `ExceptionInInitializerError`) ne
     * doit jamais faire planter un menu. On rend le texte tel quel en cas d'échec,
     * les `%papi%` restent simplement non résolus.
     */
    open fun resolve(player: Player, text: String): String =
        runCatching { me.clip.placeholderapi.PlaceholderAPI.setPlaceholders(player, text) }
            .getOrDefault(text)

    companion object {
        fun tryInit(): PapiProvider? = runCatching {
            Class.forName("me.clip.placeholderapi.PlaceholderAPI")
            PapiProvider()
        }.getOrNull()
    }
}

class WorldGuardProvider {
    fun isInRegion(player: Player, region: String): Boolean = runCatching {
        val wg = com.sk89q.worldguard.WorldGuard.getInstance()
        val loc = com.sk89q.worldedit.bukkit.BukkitAdapter.adapt(player.location)
        val container = wg.platform.regionContainer
        val regions = container.createQuery().getApplicableRegions(loc)
        regions.regions.any { it.id.equals(region, ignoreCase = true) }
    }.getOrDefault(false)

    companion object {
        fun tryInit(): WorldGuardProvider? = runCatching {
            Class.forName("com.sk89q.worldguard.WorldGuard")
            WorldGuardProvider()
        }.getOrNull()
    }
}

// ─── Custom item stack renderers ────────────────────────────────────────────

class NexoItemRenderer {
    fun buildStack(id: String, count: Int): ItemStack? = runCatching {
        val nexoItems = Class.forName("com.nexomc.nexo.api.NexoItems")
        val builder = nexoItems.getMethod("itemFromId", String::class.java).invoke(null, id)
            ?: return@runCatching null
        (builder.javaClass.getMethod("getFinalItemStack").invoke(builder) as ItemStack)
            .clone().also { it.amount = count.coerceAtLeast(1) }
    }.getOrNull()

    /** Reverse lookup: the Nexo id of an arbitrary stack, or null (capture enrichment). */
    fun idFrom(stack: ItemStack): String? = runCatching {
        val nexoItems = Class.forName("com.nexomc.nexo.api.NexoItems")
        nexoItems.getMethod("idFromItem", ItemStack::class.java).invoke(null, stack) as? String
    }.getOrNull()

    companion object {
        fun tryInit(): NexoItemRenderer? = runCatching {
            Class.forName("com.nexomc.nexo.api.NexoItems")
            NexoItemRenderer()
        }.getOrNull()
    }
}

class OraxenItemRenderer {
    fun buildStack(id: String, count: Int): ItemStack? = runCatching {
        val oraxenItems = Class.forName("io.th0rgal.oraxen.api.OraxenItems")
        val builder = oraxenItems.getMethod("getItemById", String::class.java).invoke(null, id)
            ?: return@runCatching null
        (builder.javaClass.getMethod("build").invoke(builder) as ItemStack)
            .also { it.amount = count.coerceAtLeast(1) }
    }.getOrNull()

    companion object {
        fun tryInit(): OraxenItemRenderer? = runCatching {
            Class.forName("io.th0rgal.oraxen.api.OraxenItems")
            OraxenItemRenderer()
        }.getOrNull()
    }
}

class ItemsAdderItemRenderer {
    fun buildStack(id: String, count: Int): ItemStack? = runCatching {
        val customStack = Class.forName("dev.lone.itemsadder.api.CustomStack")
        val instance = customStack.getMethod("getInstance", String::class.java).invoke(null, id)
            ?: return@runCatching null
        (instance.javaClass.getMethod("getItemStack").invoke(instance) as ItemStack)
            .clone().also { it.amount = count.coerceAtLeast(1) }
    }.getOrNull()

    companion object {
        fun tryInit(): ItemsAdderItemRenderer? = runCatching {
            Class.forName("dev.lone.itemsadder.api.CustomStack")
            ItemsAdderItemRenderer()
        }.getOrNull()
    }
}

class HeadDatabaseRenderer {
    fun buildStack(id: String, count: Int): ItemStack? = runCatching {
        val apiClass = Class.forName("me.arcaniax.hdb.api.HeadDatabaseAPI")
        val api = apiClass.getConstructor().newInstance()
        (apiClass.getMethod("getItemHead", String::class.java).invoke(api, id) as ItemStack)
            .also { it.amount = count.coerceAtLeast(1) }
    }.getOrNull()

    companion object {
        fun tryInit(): HeadDatabaseRenderer? = runCatching {
            Class.forName("me.arcaniax.hdb.api.HeadDatabaseAPI")
            HeadDatabaseRenderer()
        }.getOrNull()
    }
}

// ─── Registry ────────────────────────────────────────────────────────────────

class SoftDepRegistry(
    val vault: VaultProvider?,
    val papi: PapiProvider?,
    val worldGuard: WorldGuardProvider?,
    val nexoItems: NexoItemRenderer?,
    val oraxenItems: OraxenItemRenderer?,
    val itemsAdderItems: ItemsAdderItemRenderer?,
    val hdbHeads: HeadDatabaseRenderer? = null,
    /** Captured project items (`item:<id>` refs) — exact deserialized stacks. */
    val capturedItems: net.artisanmc.plugin.items.CapturedItemStore? = null,
) {
    constructor(plugin: JavaPlugin, capturedItems: net.artisanmc.plugin.items.CapturedItemStore? = null) : this(
        vault           = VaultProvider.tryInit(plugin),
        papi            = PapiProvider.tryInit(),
        worldGuard      = WorldGuardProvider.tryInit(),
        nexoItems       = NexoItemRenderer.tryInit(),
        oraxenItems     = OraxenItemRenderer.tryInit(),
        itemsAdderItems = ItemsAdderItemRenderer.tryInit(),
        hdbHeads        = HeadDatabaseRenderer.tryInit(),
        capturedItems   = capturedItems,
    )

    fun buildCustomStack(material: String, count: Int): ItemStack? {
        val colon = material.indexOf(':')
        if (colon < 0) return null
        val ns = material.substring(0, colon)
        val id = material.substring(colon + 1)
        return when (ns) {
            "nexo"       -> nexoItems?.buildStack(id, count)
            "oraxen"     -> oraxenItems?.buildStack(id, count)
            "itemsadder" -> itemsAdderItems?.buildStack(id, count)
            // Captured item: the exact stored stack. The appearance count only
            // overrides when explicitly > 1 — otherwise the captured amount
            // (e.g. a 5-key bundle) is the intent.
            "item"       -> capturedItems?.resolve(id)?.also { if (count > 1) it.amount = count }
            else         -> null
        }
    }

    companion object {
        val EMPTY = SoftDepRegistry(
            vault = null, papi = null, worldGuard = null,
            nexoItems = null, oraxenItems = null, itemsAdderItems = null,
            hdbHeads = null,
        )
    }
}
