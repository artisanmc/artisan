package net.artisanmc.plugin.hub

import java.util.logging.Logger

/** Les routes que l'éditeur appelait sur le backend, servies par le serveur lui-même. */
object EditorApi {
    fun router(servers: Servers, sessions: Sessions, logger: Logger?, vanilla: VanillaAssets? = null, packs: PackStore? = null): Router {
        val router = Router()
        val relay = Relay(logger)
        AccountRoutes(servers, sessions).register(router)
        ServerRoutes(servers, relay).register(router)
        ProjectRoutes(servers, relay).register(router)
        ItemRoutes(servers, relay, vanilla).register(router)
        packs?.let { PackRoutes(servers, it).register(router) }
        return router
    }
}
