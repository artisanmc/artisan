package net.artisanmc.plugin.hub

import java.util.logging.Logger

/** Les routes que l'éditeur appelait sur le backend, servies par le serveur lui-même. */
object EditorApi {
    fun router(server: LocalServer, sessions: Sessions, logger: Logger?, vanilla: VanillaAssets? = null): Router {
        val router = Router()
        val relay = Relay(server, logger)
        AccountRoutes(server, sessions).register(router)
        ServerRoutes(server, relay).register(router)
        ProjectRoutes(server, relay).register(router)
        ItemRoutes(server, vanilla).register(router)
        return router
    }
}
