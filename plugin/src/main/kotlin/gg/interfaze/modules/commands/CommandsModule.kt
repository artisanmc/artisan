package gg.interfaze.modules.commands

import gg.interfaze.modules.api.InterfazeAPI
import gg.interfaze.modules.api.InterfazeModule

/**
 * Encapsulates the existing CommandRegistrar / IfzCommand / CommandCompiler pipeline.
 * V1 scope: thin wrapper. Physical relocation happens in Phase B5.
 */
class CommandsModule : InterfazeModule {
    override val id = "commands"
    override val schemaVersion = "command/v1"

    override fun onEnable(api: InterfazeAPI) {
        // Wiring done by InterfazePlugin for V1 — see B5 for relocation plan.
    }

    override fun onDisable() {}
    override fun onReload() {}
}
