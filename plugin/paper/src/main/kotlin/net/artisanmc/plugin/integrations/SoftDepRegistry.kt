package net.artisanmc.plugin.integrations

import net.artisanmc.plugin.customitems.CustomItemPlugin
import net.artisanmc.plugin.customitems.CustomItemPlugins
import net.milkbowl.vault.economy.Economy
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import org.bukkit.plugin.java.JavaPlugin
import net.artisanmc.plugin.engine.PapiExpansion
import net.artisanmc.plugin.engine.PapiPlaceholderCatalog

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
     * Tolerant: an installed but **broken** PlaceholderAPI (e.g. Paper version
     * mismatch, its `<clinit>` throws `ExceptionInInitializerError`) must never crash
     * a menu. On failure the text is returned as is, `%papi%` simply stay unresolved.
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

class SoftDepRegistry(
    val vault: VaultProvider?,
    val papi: PapiProvider?,
    val worldGuard: WorldGuardProvider?,
    /** The custom-items plugins whose API loads, building their `<namespace>:<id>` materials. */
    val customItems: List<CustomItemPlugin> = emptyList(),
    val hdbHeads: HeadDatabaseRenderer? = null,
    /** Captured project items (`item:<id>` refs) — exact deserialized stacks. */
    val capturedItems: net.artisanmc.plugin.items.CapturedItemStore? = null,
) {
    /** [placeholders] = the add-on namespaces, resolved before PlaceholderAPI. */
    constructor(
        plugin: JavaPlugin,
        capturedItems: net.artisanmc.plugin.items.CapturedItemStore? = null,
        placeholders: PaperPlaceholders? = null,
    ) : this(
        vault           = VaultProvider.tryInit(plugin),
        papi            = PapiProvider.tryInit().let { placeholders?.pipeline(it) ?: it },
        worldGuard      = WorldGuardProvider.tryInit(),
        customItems     = CustomItemPlugins.withApi(),
        hdbHeads        = HeadDatabaseRenderer.tryInit(),
        capturedItems   = capturedItems,
    )

    fun buildCustomStack(material: String, count: Int): ItemStack? {
        val colon = material.indexOf(':')
        if (colon < 0) return null
        val ns = material.substring(0, colon)
        val id = material.substring(colon + 1)
        return when (ns) {
            // Captured item: the exact stored stack. The appearance count only
            // overrides when explicitly > 1 — otherwise the captured amount
            // (e.g. a 5-key bundle) is the intent.
            "item"       -> capturedItems?.resolve(id)?.also { if (count > 1) it.amount = count }
            else         -> customItems.firstOrNull { it.namespace == ns }?.buildStack(id, count)
        }
    }

    companion object {
        val EMPTY = SoftDepRegistry(
            vault = null, papi = null, worldGuard = null,
            hdbHeads = null,
        )
    }
}
