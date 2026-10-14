package net.artisanmc.plugin.hub

import java.util.logging.Logger

/** The routes the editor calls, served by the Minecraft server itself. */
object EditorApi {
    fun router(servers: Servers, sessions: Sessions, logger: Logger?, vanilla: VanillaAssets? = null, packs: PackStore? = null, prefs: PlayerPrefs? = null, history: ProjectHistory? = null, loaded: LoadedProjects? = null,
        drafts: DraftStorage? = null,
    ): Router {
        val router = Router()
        val relay = Relay(logger)
        AccountRoutes(servers, sessions, prefs).register(router)
        ServerRoutes(servers, relay).register(router)
        ProjectRoutes(servers, relay, history, loaded, drafts, logger).register(router)
        ItemRoutes(servers, relay, vanilla).register(router)
        packs?.let { PackRoutes(servers, it).register(router) }
        return router
    }
}
