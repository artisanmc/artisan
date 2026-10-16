package net.artisanmc.plugin

import net.artisanmc.modules.api.*
import net.artisanmc.modules.api.schemas.SchemaRegistry
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.provider.SyncedMenuProvider
import java.io.File

/**
 * The [ArtisanAPI] Add-ons see, built once at enable before any runtime exists: every
 * piece of the runtime it reaches (provider, executor, sessions) is read at call time,
 * and is absent until the first load.
 */
internal object ArtisanApiFactory {
    fun build(plugin: ArtisanPlugin): ArtisanAPI {
        val registry = ModuleRegistry()
        val customForCapture = net.artisanmc.plugin.customitems.CustomItemPlugins.withApi()
        plugin.projectRoots = net.artisanmc.plugin.project.ProjectRoots(File(plugin.dataFolder, "projects"), plugin.logger)
        plugin.database = net.artisanmc.plugin.database.PooledDatabase(plugin::databaseSettings, plugin.logger)
        val api = ArtisanAPI.builder(
            plugin,
            DataSourceRegistry(),
            CommandRegistry(),
            ModuleEventBus(),
            SchemaRegistry(),
            registry,
            plugin.description.version,
            // The provider is created later (it needs the API): the reload
            // resolves at call time, not at construction.
            net.artisanmc.plugin.project.ProjectContentReader(
                plugin.projectRoots,
                onReloadRequested = { plugin.refreshProjectsFromDisk() },
                bundles = { plugin.menuProviderOrNull?.allBundles() ?: emptyList() },
            ),
        )
            .projectRoots(plugin.projectRoots)
            // The one kind registry: the core kinds registered first, then
            // what modules add through api.documentKinds (W6).
            .documentKinds(DocumentKinds.coreRegistry().also(DocumentKinds::bind))
            .items(object : net.artisanmc.modules.api.ItemStackApi {
                override fun serialize(stack: org.bukkit.inventory.ItemStack): String =
                    net.artisanmc.plugin.items.ItemDescriptor.serialize(stack)
                override fun describe(stack: org.bukkit.inventory.ItemStack): Map<String, Any> =
                    net.artisanmc.plugin.items.ItemDescriptor.derive(stack, customForCapture)
            })
            .actions(object : net.artisanmc.modules.api.ModuleActionsApi {
                override fun execute(
                    player: org.bukkit.entity.Player,
                    actions: String,
                    args: Map<String, Any>,
                    projectId: String?,
                ) {
                    if (actions.isBlank()) return
                    val run = Runnable {
                        val parsed = try {
                            net.artisanmc.plugin.actiondsl.dslToEngineSteps(
                                net.artisanmc.plugin.actiondsl.parseActionDsl(actions),
                            )
                        } catch (e: Exception) {
                            plugin.logger.warning("[Artisan] module actions skipped — malformed DSL: ${e.message}")
                            return@Runnable
                        }
                        val executor = plugin.runtime.executorOrNull ?: run {
                            plugin.logger.warning("[Artisan] module actions dropped — engine not initialized")
                            return@Runnable
                        }
                        // The project's i18n scope: without it an action
                        // carrying `@key` would show a raw "{i18n:key}".
                        val lang = plugin.langManagerOrNull?.playerLang(player) ?: "en"
                        val bundles = plugin.menuProviderOrNull?.allBundles() ?: emptyList()
                        val langMap =
                            net.artisanmc.plugin.provider.projectLangMap(bundles, projectId, lang)
                        executor.executeSteps(
                            parsed,
                            net.artisanmc.plugin.engine.ExecutionContext(
                                player = player,
                                args = args,
                                lang = lang,
                                langMap = langMap,
                                projectId = projectId,
                            ),
                        )
                    }
                    plugin.scheduler.onPlayer(player.uniqueId, run::run)
                }
            })
            .database(plugin.database)
            .menus(net.artisanmc.plugin.provider.PaperMenuApi(
                provider = { plugin.menuProviderOrNull },
                sessions = { plugin.runtime.sessionsOrNull },
                langOf = { plugin.langManagerOrNull?.playerLang(it) ?: "en" },
                scheduler = plugin.scheduler,
                events = plugin.menuEvents,
            ))
            .scheduler(net.artisanmc.plugin.scheduling.PaperSchedulerApi)
            .placeholders(plugin.placeholders)
            // Artisan's own actions are registered like a module's: every chain, core
            // included, dispatches through this registry (ADR extensible-document-kinds, R1).
            .actionRegistry(ActionRegistry().also(net.artisanmc.plugin.engine.CoreActionHandlers::registerAll))
            .build()
        // A module reports the core plugin version: ArtisanModule has no version of its own.
        registry.bind(api) {
            (plugin.menuProviderOrNull as? SyncedMenuProvider)?.notifyModulesChanged(
                registry.active().map { mapOf("id" to it.id, "version" to plugin.description.version) },
            )
        }
        return api
    }
}
