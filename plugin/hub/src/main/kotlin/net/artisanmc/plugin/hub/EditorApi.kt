package net.artisanmc.plugin.hub

import java.util.logging.Logger

/** The routes the editor calls, served by the Minecraft server itself. */
object EditorApi {
    fun router(servers: Servers, sessions: Sessions, logger: Logger?, vanilla: VanillaAssets? = null, packs: PackStore? = null, prefs: PlayerPrefs? = null, history: ProjectHistory? = null, loaded: LoadedProjects? = null,
        drafts: DraftStorage? = null, bedrockPacks: PackStore? = null,
        /** The tunnel this hub is reached through, once open (ADR `editor-tunnel`). */
        tunnel: () -> TunnelNames? = { null },
        /** The MCP endpoint's grants when `web.mcp` is on (ADR `mcp-server`); null: no `/mcp`, no OAuth. */
        mcp: McpGrants? = null,
        /** The `ai` section of environment.yml (ADR `editor-assistant`); it wins over [aiSettings]. */
        ai: AiConfig = AiConfig(),
        /** The assistant's settings saved from the editor; null: environment.yml alone. */
        aiSettings: AiSettingsStore? = null,
        /** The model the assistant talks to; null: the one its settings name. */
        aiProvider: AiProvider? = null,
        /** Where the assistant's conversations are kept; null: in memory, a restart ends them. */
        aiConversations: AiConversationStore? = null,
        version: String = "",
        /** The public ids of the sessions with an editor tab open here ([EditorChannel.online]). */
        online: () -> Set<String> = { emptySet() },
        /** Free or Pro jar: the editor hides Pro editing, the hub refuses a new pack in free. */
        edition: Edition = Edition.PRO,
        /** Artisan's pack host (`web.pack-cdn`); null: players download packs from this server. */
        packCdn: PackCdn? = null,
        /** The hub's own pack build, in shadow mode: compared with the packs the editor uploads. */
        packBuilder: PackBuilder? = null,
    ): Router {
        val router = Router()
        val relay = Relay(logger)
        AccountRoutes(servers, sessions, prefs, edition).register(router)
        SessionRoutes(servers, sessions, online).register(router)
        ServerRoutes(servers, relay).register(router)
        ProjectRoutes(servers, relay, history, loaded, drafts, logger).register(router)
        ItemRoutes(servers, relay, vanilla).register(router)
        packs?.let { store ->
            PackRoutes(servers, store, packCdn, edition, bedrockPacks) { server, hash ->
                packBuilder?.editorUploaded(server, hash)
            }.register(router)
        }
        AddressRoutes(tunnel, sessions).register(router)
        val tools = McpTools(McpProjects(servers, loaded, drafts, history), packs = packBuilder)
        if (mcp != null) {
            OAuthRoutes(mcp).register(router)
            McpRoutes(tools, mcp, version, logger).register(router)
        }
        AiRoutes(aiSetup(ai, aiSettings, aiProvider, tools, logger, aiConversations)).register(router)
        return router
    }

    private fun aiSetup(ai: AiConfig, settings: AiSettingsStore?, given: AiProvider?, tools: McpTools, logger: Logger?, conversations: AiConversationStore?): AiSetup =
        when {
            given == null -> AiSetup(ai, settings, tools, logger, conversations = conversations)
            settings == null -> AiSetup(AiConfig(provider = "given", apiKey = "given", model = given.model, maxSteps = ai.maxSteps), null, tools, logger, providerFor = { given }, conversations = conversations)
            else -> AiSetup(ai, settings, tools, logger, providerFor = { given }, conversations = conversations)
        }
}
