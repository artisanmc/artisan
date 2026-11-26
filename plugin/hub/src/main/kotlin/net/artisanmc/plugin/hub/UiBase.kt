package net.artisanmc.plugin.hub

import net.artisanmc.plugin.pack.Kit

/**
 * The base Artisan ships (the pack builder's own copy, `editor/src/assets/kit`), for the server
 * that writes it under `themes/artisan/originals/` (`ArtisanTheme`): each image by its name, each component's file by its name.
 */
object UiBase {
    fun images(): Map<String, ByteArray> = Kit.slots.associate { it.id to Kit.shipped(it) }

    fun components(): Map<String, String> = Kit.components
}
