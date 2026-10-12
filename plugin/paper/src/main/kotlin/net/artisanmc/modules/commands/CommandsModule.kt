package net.artisanmc.modules.commands

import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule

/**
 * Encapsulates the existing CommandRegistrar / ArtisanCommand / CommandCompiler pipeline.
 * V1 scope: thin wrapper. Physical relocation happens in Phase B5.
 */
class CommandsModule : ArtisanModule {
    override val id = "commands"
    override val schemaVersion = "command/v1"

    override fun onEnable(api: ArtisanAPI) {
        // Wiring done by ArtisanPlugin for V1 — see B5 for relocation plan.
    }

    override fun onDisable() {}
    override fun onReload() {}
}
