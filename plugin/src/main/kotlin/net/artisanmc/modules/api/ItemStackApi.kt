package net.artisanmc.modules.api

import net.artisanmc.modules.api.annotations.Beta
import org.bukkit.inventory.ItemStack

/**
 * Captured-item helpers for modules (ADR `captured-items-and-module-field-kit`):
 * the canonical wrapped serialization of a stack (what the backend stores under
 * `items/<id>.yml`) and the generic display descriptor (material — enriched to a
 * recognized custom ref when possible —, head_texture, enchanted, count, name).
 * Modules use these to build capture payloads (e.g. `/boutique additem`) without
 * touching core internals.
 */
@Beta
interface ItemStackApi {
    fun serialize(stack: ItemStack): String
    fun describe(stack: ItemStack): Map<String, Any>

    companion object {
        /** Inert default (tests / partial wiring). */
        @JvmField
        val NOOP: ItemStackApi = object : ItemStackApi {
            override fun serialize(stack: ItemStack): String = ""
            override fun describe(stack: ItemStack): Map<String, Any> = emptyMap()
        }
    }
}
