package net.artisanmc.modules.commands

import net.artisanmc.modules.api.ArtisanAPI
import net.artisanmc.modules.api.ArtisanModule

/**
 * The CommandRegistrar / ArtisanCommand / CommandCompiler pipeline as a module.
 * A thin wrapper: those classes are wired by ArtisanPlugin.
 */
class CommandsModule : ArtisanModule {
    override fun getId() = "commands"
    override fun getSchemaVersion() = "command/v1"

    override fun onEnable(api: ArtisanAPI) {
    }

    override fun onDisable() {}
    override fun onReload() {}
}
