package net.artisanmc.modules.api;

import java.util.Map;
import java.util.Objects;
import net.artisanmc.modules.api.action.ActionRegistry;
import net.artisanmc.modules.api.action.ModuleActionsApi;
import net.artisanmc.modules.api.annotations.Beta;
import net.artisanmc.modules.api.annotations.Internal;
import net.artisanmc.modules.api.annotations.Stable;
import net.artisanmc.modules.api.command.CommandRegistry;
import net.artisanmc.modules.api.condition.ConditionsApi;
import net.artisanmc.modules.api.database.DatabaseApi;
import net.artisanmc.modules.api.datasource.DataSourceRegistry;
import net.artisanmc.modules.api.document.DocumentKindRegistry;
import net.artisanmc.modules.api.editor.EditorBundleRegistry;
import net.artisanmc.modules.api.event.ModuleEventBus;
import net.artisanmc.modules.api.item.ItemStackApi;
import net.artisanmc.modules.api.menu.MenuApi;
import net.artisanmc.modules.api.model.ModelRegistry;
import net.artisanmc.modules.api.placeholder.PlaceholderRegistry;
import net.artisanmc.modules.api.project.ProjectContentApi;
import net.artisanmc.modules.api.project.ProjectRootRegistry;
import net.artisanmc.modules.api.scheduler.SchedulerApi;
import net.artisanmc.modules.api.schemas.SchemaRegistry;
import net.artisanmc.modules.api.screen.EditorScreenRegistry;
import net.artisanmc.modules.api.template.TemplateRegistry;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Facade passed to every module at {@code onEnable(api)}. Exposes:
 * <ul>
 *   <li>the {@link #getPlugin() plugin} handle (server, data folder)</li>
 *   <li>the cross-module registries ({@link #getDataSources() dataSources}, {@link #getCommands() commands})</li>
 *   <li>the {@link #getEvents() events} bus between modules</li>
 *   <li>the {@link #getSchemas() schemas} registry for versioned data migrations</li>
 *   <li>the {@link #getModules() modules} runtime registry</li>
 *   <li>the {@link #getProjectRoots() projectRoots} registry for add-on-owned project directories</li>
 *   <li>the {@link #getDatabase() database} lent to the plugins of the suite (one pool per plugin)</li>
 * </ul>
 *
 * <p>Modules MUST go through this facade. Obtain it via Bukkit's {@code ServicesManager}:
 * {@code server.getServicesManager().load(ArtisanAPI.class)}.
 *
 * <p>Only Artisan builds it ({@link #builder}).
 */
@Stable
public final class ArtisanAPI {
    private final JavaPlugin plugin;
    private final DataSourceRegistry dataSources;
    private final CommandRegistry commands;
    private final ModuleEventBus events;
    private final SchemaRegistry<Map<String, Object>> schemas;
    private final ModuleRegistry modules;
    private final String coreVersion;
    private final ProjectContentApi project;
    private final ProjectRootRegistry projectRoots;
    private final ItemStackApi items;
    private final ModuleActionsApi actions;
    private final ModelRegistry models;
    private final EditorScreenRegistry screens;
    private final ActionRegistry actionRegistry;
    private final DocumentKindRegistry documentKinds;
    private final EditorBundleRegistry editorBundles;
    private final TemplateRegistry templates;
    private final DatabaseApi database;
    private final MenuApi menus;
    private final SchedulerApi scheduler;
    private final PlaceholderRegistry placeholders;
    private final ConditionsApi conditions;

    private ArtisanAPI(Builder b) {
        this.plugin = b.plugin;
        this.dataSources = b.dataSources;
        this.commands = b.commands;
        this.events = b.events;
        this.schemas = b.schemas;
        this.modules = b.modules;
        this.coreVersion = b.coreVersion;
        this.project = b.project;
        this.projectRoots = b.projectRoots;
        this.items = b.items;
        this.actions = b.actions;
        this.models = b.models;
        this.screens = b.screens;
        this.actionRegistry = b.actionRegistry;
        this.documentKinds = b.documentKinds;
        this.editorBundles = b.editorBundles;
        this.templates = b.templates;
        this.database = b.database;
        this.menus = b.menus;
        this.scheduler = b.scheduler;
        this.placeholders = b.placeholders;
        this.conditions = b.conditions;
    }

    /**
     * Starts a facade from its required parts; the optional surfaces default to their inert
     * implementations ({@code NOOP}, {@code NONE}, {@code DIRECT}, empty registries).
     */
    @Internal
    public static Builder builder(
        JavaPlugin plugin,
        DataSourceRegistry dataSources,
        CommandRegistry commands,
        ModuleEventBus events,
        SchemaRegistry<Map<String, Object>> schemas,
        ModuleRegistry modules,
        String coreVersion,
        ProjectContentApi project
    ) {
        return new Builder(plugin, dataSources, commands, events, schemas, modules, coreVersion, project);
    }

    @Stable
    public JavaPlugin getPlugin() {
        return plugin;
    }

    @Stable
    public DataSourceRegistry getDataSources() {
        return dataSources;
    }

    @Stable
    public CommandRegistry getCommands() {
        return commands;
    }

    @Stable
    public ModuleEventBus getEvents() {
        return events;
    }

    @Stable
    public SchemaRegistry<Map<String, Object>> getSchemas() {
        return schemas;
    }

    @Stable
    public ModuleRegistry getModules() {
        return modules;
    }

    /** The Artisan plugin version ({@code plugin.yml}, {@code 1.0.<build>}). Not the API version: see {@link #getApiVersion()}. */
    @Stable
    public String getCoreVersion() {
        return coreVersion;
    }

    @Stable
    public ProjectContentApi getProject() {
        return project;
    }

    @Stable
    public ProjectRootRegistry getProjectRoots() {
        return projectRoots;
    }

    @Beta
    public ItemStackApi getItems() {
        return items;
    }

    @Beta
    public ModuleActionsApi getActions() {
        return actions;
    }

    /** Module-declared Data models, model/v1 passthrough to Presence (ADR {@code composable-data-models}). */
    @Beta
    public ModelRegistry getModels() {
        return models;
    }

    /** Module-declared Config screens, reported at Presence (ADR {@code module-config-screens}). */
    @Beta
    public EditorScreenRegistry getScreens() {
        return screens;
    }

    /**
     * The action vocabulary (ADR {@code extensible-document-kinds}): the declarations a chain may
     * invoke, core and module alike, dispatched by name. Reported at Presence as
     * {@code declared_actions}.
     */
    @Beta
    public ActionRegistry getActionRegistry() {
        return actionRegistry;
    }

    /**
     * The Document kinds a project may hold (ADR {@code extensible-document-kinds}, decisions 1, 10
     * and 11): Artisan's own and the modules'. The core reads a project's folders from it and
     * reports it at Presence as {@code document_kinds}.
     */
    @Beta
    public DocumentKindRegistry getDocumentKinds() {
        return documentKinds;
    }

    /**
     * The modules' editor views, shipped in their jars (runtime module bundles, level 3): one
     * script per module, reported at Presence on its {@code installed_modules} entry and served
     * to the editor by the hub.
     */
    @Beta
    public EditorBundleRegistry getEditorBundles() {
        return editorBundles;
    }

    /**
     * The modules' example content, shipped in their jars: files the editor copies into any
     * project, and that Artisan may copy once into a project of their own on first start. Reported
     * at Presence on the module's {@code installed_modules} entry ({@code templates}).
     */
    @Beta
    public TemplateRegistry getTemplates() {
        return templates;
    }

    /** One connection pool per plugin, credentials in {@code environment.yml} (ADR {@code suite-foundation-database}). */
    @Beta
    public DatabaseApi getDatabase() {
        return database;
    }

    /** Open, query and watch menus. */
    @Beta
    public MenuApi getMenus() {
        return menus;
    }

    /** Artisan's Folia-aware scheduler. */
    @Beta
    public SchedulerApi getScheduler() {
        return scheduler;
    }

    /** {@code %namespace_key%} placeholders for menus, optionally exposed to PlaceholderAPI. */
    @Beta
    public PlaceholderRegistry getPlaceholders() {
        return placeholders;
    }

    /** Conditions evaluated outside a chain, with the evaluator of {@code if:} (a module's requirements). */
    @Beta
    public ConditionsApi getConditions() {
        return conditions;
    }

    /** Version of this API (the {@code Since} numbering of the published {@code artisan-core-api}). */
    @Stable
    public String getApiVersion() {
        return ApiVersion.CURRENT;
    }

    /** True if the running API satisfies the add-on's minimum API version (same major, {@link #getApiVersion()} &gt;= min). */
    @Stable
    public boolean isCompatibleWith(String minVersion) {
        return SemVer.satisfies(getApiVersion(), minVersion);
    }

    /** Assembles an {@link ArtisanAPI}; Artisan's own wiring, not for add-ons. */
    @Internal
    public static final class Builder {
        private final JavaPlugin plugin;
        private final DataSourceRegistry dataSources;
        private final CommandRegistry commands;
        private final ModuleEventBus events;
        private final SchemaRegistry<Map<String, Object>> schemas;
        private final ModuleRegistry modules;
        private final String coreVersion;
        private final ProjectContentApi project;
        private ProjectRootRegistry projectRoots = ProjectRootRegistry.NOOP;
        private ItemStackApi items = ItemStackApi.NOOP;
        private ModuleActionsApi actions = ModuleActionsApi.NOOP;
        private ModelRegistry models = new ModelRegistry();
        private EditorScreenRegistry screens = new EditorScreenRegistry();
        private ActionRegistry actionRegistry = new ActionRegistry();
        private DocumentKindRegistry documentKinds = new DocumentKindRegistry();
        private EditorBundleRegistry editorBundles = new EditorBundleRegistry();
        private TemplateRegistry templates = new TemplateRegistry();
        private DatabaseApi database = DatabaseApi.NONE;
        private MenuApi menus = MenuApi.NOOP;
        private SchedulerApi scheduler = SchedulerApi.DIRECT;
        private PlaceholderRegistry placeholders = PlaceholderRegistry.NOOP;
        private ConditionsApi conditions = ConditionsApi.NOOP;

        private Builder(
            JavaPlugin plugin,
            DataSourceRegistry dataSources,
            CommandRegistry commands,
            ModuleEventBus events,
            SchemaRegistry<Map<String, Object>> schemas,
            ModuleRegistry modules,
            String coreVersion,
            ProjectContentApi project
        ) {
            this.plugin = Objects.requireNonNull(plugin, "plugin");
            this.dataSources = Objects.requireNonNull(dataSources, "dataSources");
            this.commands = Objects.requireNonNull(commands, "commands");
            this.events = Objects.requireNonNull(events, "events");
            this.schemas = Objects.requireNonNull(schemas, "schemas");
            this.modules = Objects.requireNonNull(modules, "modules");
            this.coreVersion = Objects.requireNonNull(coreVersion, "coreVersion");
            this.project = Objects.requireNonNull(project, "project");
        }

        public Builder projectRoots(ProjectRootRegistry projectRoots) {
            this.projectRoots = Objects.requireNonNull(projectRoots);
            return this;
        }

        public Builder items(ItemStackApi items) {
            this.items = Objects.requireNonNull(items);
            return this;
        }

        public Builder actions(ModuleActionsApi actions) {
            this.actions = Objects.requireNonNull(actions);
            return this;
        }

        public Builder models(ModelRegistry models) {
            this.models = Objects.requireNonNull(models);
            return this;
        }

        public Builder screens(EditorScreenRegistry screens) {
            this.screens = Objects.requireNonNull(screens);
            return this;
        }

        public Builder actionRegistry(ActionRegistry actionRegistry) {
            this.actionRegistry = Objects.requireNonNull(actionRegistry);
            return this;
        }

        public Builder documentKinds(DocumentKindRegistry documentKinds) {
            this.documentKinds = Objects.requireNonNull(documentKinds);
            return this;
        }

        public Builder editorBundles(EditorBundleRegistry editorBundles) {
            this.editorBundles = Objects.requireNonNull(editorBundles);
            return this;
        }

        public Builder templates(TemplateRegistry templates) {
            this.templates = Objects.requireNonNull(templates);
            return this;
        }

        public Builder database(DatabaseApi database) {
            this.database = Objects.requireNonNull(database);
            return this;
        }

        public Builder menus(MenuApi menus) {
            this.menus = Objects.requireNonNull(menus);
            return this;
        }

        public Builder scheduler(SchedulerApi scheduler) {
            this.scheduler = Objects.requireNonNull(scheduler);
            return this;
        }

        public Builder placeholders(PlaceholderRegistry placeholders) {
            this.placeholders = Objects.requireNonNull(placeholders);
            return this;
        }

        public Builder conditions(ConditionsApi conditions) {
            this.conditions = Objects.requireNonNull(conditions);
            return this;
        }

        public ArtisanAPI build() {
            return new ArtisanAPI(this);
        }
    }
}
