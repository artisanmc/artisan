package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.OfflinePlayer
import java.math.BigDecimal
import java.util.concurrent.ConcurrentHashMap

@Beta
class DuplicateCurrencyException(id: String) :
    IllegalStateException("Currency '$id' is already registered")

/**
 * One currency of the server (`vault`, `playerpoints`, a plugin's tokens…).
 * Amounts are [BigDecimal] so that a module adding up prices and taxes never
 * drifts; a provider backed by a `double` API converts at its own boundary.
 * Calls happen on the main thread.
 */
@Beta
interface CurrencyProvider {
    /** Stable id referenced by actions (`take_money … currency`) and modules. */
    val id: String

    fun balance(player: OfflinePlayer): BigDecimal

    /** False when the player cannot pay: nothing was taken. */
    fun withdraw(player: OfflinePlayer, amount: BigDecimal): Boolean

    /** False when the provider refused the deposit. */
    fun deposit(player: OfflinePlayer, amount: BigDecimal): Boolean
}

/**
 * The currencies known to the server, shared by the core actions
 * (`give_money`, `take_money`, `has_money`) and the modules. An action without
 * `currency` uses [defaultCurrency]; an unknown currency is never replaced by
 * another one: the action fails and the condition is false.
 */
@Beta
class EconomyRegistry {
    private val providers = ConcurrentHashMap<String, CurrencyProvider>()

    /** Id used when an action names no currency. `vault` unless changed. */
    @Volatile var defaultCurrency: String = "vault"

    fun register(provider: CurrencyProvider) {
        if (providers.putIfAbsent(provider.id, provider) != null) {
            throw DuplicateCurrencyException(provider.id)
        }
    }

    fun unregister(id: String) {
        providers.remove(id)
    }

    /** The provider for [id], or for [defaultCurrency] when [id] is null or blank. */
    fun get(id: String?): CurrencyProvider? =
        providers[if (id.isNullOrBlank()) defaultCurrency else id]

    fun has(id: String): Boolean = providers.containsKey(id)

    fun ids(): Set<String> = providers.keys.toSet()
}
