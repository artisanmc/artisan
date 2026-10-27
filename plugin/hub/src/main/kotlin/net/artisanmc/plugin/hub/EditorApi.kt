package net.artisanmc.plugin.hub

import java.util.logging.Logger

/** The routes the editor calls, served by the Minecraft server itself. */
object EditorApi {
    fun router(servers: Servers, sessions: Sessions, logger: Logger?, vanilla: VanillaAssets? = null, packs: PackStore? = null, prefs: PlayerPrefs? = null, history: ProjectHistory? = null, loaded: LoadedProjects? = null,
        drafts: DraftStorage? = null,
        /** The tunnel this hub is reached through, once open (ADR `editor-tunnel`). */
        tunnel: () -> TunnelNames? = { null },
        /** The MCP endpoint's grants when `web.mcp` is on (ADR `mcp-server`); null: no `/mcp`, no OAuth. */
        mcp: McpGrants? = null,
        /** The `ai` section of environment.yml (ADR `editor-assistant`); disabled: no assistant. */
        ai: AiConfig = AiConfig(),
        /** The model the assistant talks to; null: the one [ai] names. */
        aiProvider: AiProvider? = null,
        version: String = "",
        /** The public ids of the sessions with an editor tab open here ([EditorChannel.online]). */
        online: () -> Set<String> = { emptySet() },
    ): Router {
        val router = Router()
        val relay = Relay(logger)
        AccountRoutes(servers, sessions, prefs).register(router)
        SessionRoutes(servers, sessions, online).register(router)
        ServerRoutes(servers, relay).register(router)
        ProjectRoutes(servers, relay, history, loaded, drafts, logger).register(router)
        ItemRoutes(servers, relay, vanilla).register(router)
        packs?.let { PackRoutes(servers, it).register(router) }
        AddressRoutes(tunnel, sessions).register(router)
        val tools = McpTools(McpProjects(servers, loaded, drafts))
        if (mcp != null) {
            OAuthRoutes(mcp).register(router)
            McpRoutes(tools, mcp, version, logger).register(router)
        }
        AiRoutes(assistant(ai, aiProvider, tools, logger)).register(router)
        return router
    }

    private fun assistant(ai: AiConfig, given: AiProvider?, tools: McpTools, logger: Logger?): AiAssistant? {
        if (given != null) return AiAssistant(given, tools, ai.maxSteps, logger)
        if (!ai.enabled) return null
        val provider = when (ai.provider) {
            "anthropic" -> AnthropicProvider(ai)
            else -> {
                logger?.warning("[Artisan] ai.provider '${ai.provider}' is not one of ${AiConfig.PROVIDERS}: no assistant")
                return null
            }
        }
        logger?.info("[Artisan] Editor assistant enabled: ${ai.provider}, ${ai.model}")
        return AiAssistant(provider, tools, ai.maxSteps, logger)
    }
}
