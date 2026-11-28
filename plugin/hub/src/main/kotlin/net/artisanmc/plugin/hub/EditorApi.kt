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
        /** The paid tools each player always allows the assistant; null: in memory. */
        aiPermissions: AiPermissionStore? = null,
        /** The image model `generate_image` calls; null: the one the settings name (`ai.image`). */
        aiImages: ((AiImageConfig) -> ImageModel?)? = null,
        version: String = "",
        /** The public ids of the sessions with an editor tab open here ([EditorChannel.online]). */
        online: () -> Set<String> = { emptySet() },
        /** Artisan's pack host (`web.pack-cdn`); null: players download packs from this server. */
        packCdn: PackCdn? = null,
        /** The hub's own pack build: the Bedrock one applied, the Java one applied or compared with the editor's (shadow mode). */
        packBuilder: PackBuilder? = null,
        /** The statistics store (ADR `stats-foundation`); null: no `/stats` routes. */
        stats: StatsAccess? = null,
        /** The network's link to a site account (ADR `site-account-and-module-updates`); null: no `/site` routes. */
        site: SiteAccount? = null,
    ): Router {
        val router = Router()
        val relay = Relay(logger)
        AccountRoutes(servers, sessions, prefs).register(router)
        SessionRoutes(servers, sessions, online).register(router)
        ServerRoutes(servers, relay, drafts).register(router)
        ProjectRoutes(servers, relay, history, loaded, drafts, logger).register(router)
        ItemRoutes(servers, relay, vanilla).register(router)
        packs?.let { store ->
            PackRoutes(
                servers, store, packCdn, bedrockPacks,
                uploaded = { server, hash -> packBuilder?.editorUploaded(server, hash) },
                bedrockUploaded = { server, hash -> packBuilder?.bedrockApplied(server, hash) },
                builder = packBuilder,
            ).register(router)
        }
        AddressRoutes(tunnel, sessions).register(router)
        stats?.let { StatsRoutes(servers, it, relay).register(router) }
        // An item's picture for render_menu: its 3D icon, else its flat texture.
        val itemPictures = vanilla?.let { v -> { id: String -> v.texture("icons/$id") ?: v.texture("item/$id") ?: v.texture("block/$id") } }
        // The image model is the assistant's settings' (`ai.image`), which need the tools first: read at each call.
        lateinit var setup: AiSetup
        val tools = McpTools(McpProjects(servers, loaded, drafts, history), packs = packBuilder, items = itemPictures, images = { setup.current().images }, logger = logger)
        if (mcp != null) {
            OAuthRoutes(mcp, images = { setup.current().images != null }).register(router)
            McpRoutes(tools, mcp, version, logger).register(router)
        }
        site?.let { SiteRoutes(servers, relay, it, logger).register(router) }
        ImportRoutes(servers, relay, logger).register(router)
        setup = aiSetup(ai, aiSettings, aiProvider, tools, logger, aiConversations, site, aiPermissions, aiImages ?: { AiImageConfig.service(it, site) })
        AiRoutes(setup, site).register(router)
        return router
    }

    private fun aiSetup(
        ai: AiConfig, settings: AiSettingsStore?, given: AiProvider?, tools: McpTools, logger: Logger?, conversations: AiConversationStore?, site: SiteAccount?,
        permissions: AiPermissionStore?, imageFor: (AiImageConfig) -> ImageModel?,
    ): AiSetup {
        val always = permissions ?: MemoryAiPermissionStore()
        return when {
            given == null -> AiSetup(ai, settings, tools, logger, providerFor = { AiSetup.defaultProvider(it, site) }, conversations = conversations, permissions = always, imageFor = imageFor)
            settings == null -> AiSetup(
                AiConfig(provider = "given", apiKey = "given", model = given.model, maxSteps = ai.maxSteps, image = ai.image), null, tools, logger,
                providerFor = { given }, conversations = conversations, permissions = always, imageFor = imageFor,
            )
            else -> AiSetup(ai, settings, tools, logger, providerFor = { given }, conversations = conversations, permissions = always, imageFor = imageFor)
        }
    }
}
