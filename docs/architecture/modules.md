# Artisan — Architecture modules

Spec d'architecture pour le pattern "modules" qui permet à Artisan d'évoluer de "menu editor" vers "plateforme de configuration web pour plugins Minecraft", incrémentalement, sans refactor big-bang.

Statut : **architecture cible** — V1 implémente le menu editor comme premier module en suivant ce pattern. V1.5+ ajoute d'autres modules (shop, quests, kits, etc.). V3+ ouvre un SDK pour modules tiers.

> **Révision phase F (2026-10)** : plus de backend. Le plugin sert l'éditeur (module Gradle `hub`, ADR `editor-web-server`) ; un module vit en **2 endroits** (plugin + éditeur), livrés dans le même jar. Les passages sur le backend (§3.2, §3.3.5, §10 « Backend », §13.5, §13.8, §14) décrivent l'état cloud, gardé pour l'historique ; état récupérable au commit `ccade092`.

---

## 1. Vision et positioning

À long terme, Artisan n'est pas "un éditeur de menus". C'est **la couche de configuration web unifiée pour les plugins Minecraft modernes**. Le menu editor V1 est juste le **premier module** d'une plateforme plus large qui couvrira progressivement :

- Menus (V1) — design visuel des inventaires GUI
- Commandes (V1) — actions custom configurables
- Translations / i18n (V1) — multi-langue
- Shop (V1.5) — items, prix, catégories, stock
- Quests (V2) — objectives, rewards, chaînes de quêtes
- Kits (V2) — items, cooldowns, permissions
- Warps / Lobbies (V2) — locations, conditions d'accès
- Permissions UI (V2) — gestion LuckPerms/PEX via web
- Économies UI (V2) — gestion Vault custom
- etc.

Chaque module est :

1. **Indépendant** : sa propre logique, sa propre data, sa propre UX dans le web editor.
2. **Composable** : communique avec les autres modules via des **data sources** et **commands** (patterns universels), pas via couplage direct.
3. **Versionné** : son propre schema (`shop/v1`, `quest/v1`, ...) avec migrations.

Le résultat : un admin gère **tous ses plugins compatibles Artisan** depuis une UI unifiée, sans toucher à du YAML. Plus de friction de configuration.

## 2. Architecture : modular monolith

**Une seule app web, un seul plugin Java** (qui sert l'app web). Mais avec des frontières de modules claires dans le code. Pas de microfrontends, pas de Module Federation, pas de plugin SDK dynamic loading. Trop complexe pour zéro ROI tant que tu écris tous les modules toi-même.

Modular monolith donne :

- Single deployment, single CI, single team
- Iteration rapide
- UX cohérente (mêmes primitives, même design system)
- Architecture qui se prête à un futur SDK 3ᵉ party (V3+) sans refactor

**Frontières d'imports de l'éditeur, vérifiées en CI** (`npm run check:boundaries`,
`editor/scripts/check-boundaries.mjs`) : un package `editor/packages/*` n'importe pas `editor/src/`
(il passe par `@artisan/editor-sdk`) ; `domain`, `schema`, `lib`, `state` et `components`
n'importent pas `features/` ; une feature n'importe une autre feature que par un lien déjà connu.
Les violations existantes sont gelées dans `editor/boundaries-baseline.json`, qui ne peut que
rétrécir : une nouvelle violation fait échouer la CI, une violation corrigée doit en être retirée.

**Quand pivoter vers vrai plugin SDK** : seulement quand tu as 3+ modules tiers développés par d'autres et de la demande validée pour un programme officiel. Probablement V3+ ou au-delà.

## 3. Module abstraction

Un **module Artisan** vit dans 2 endroits : éditeur web (frontend) et plugin Paper. Les deux parties sont livrées ensemble (le build de l'éditeur est embarqué dans le jar du socle) mais logiquement séparées. Jusqu'à la phase F, une troisième partie vivait dans le backend (§3.2).

### 3.1 Frontend module

```
/editor/src/modules/{module_id}/
  index.ts          ← Module registration
  editor/           ← Composants UI pour configurer ce module
  preview/          ← Preview du résultat (optionnel)
  schemas/          ← JSON schemas locaux
  hooks/            ← Hooks React spécifiques au module
```

**Interface de registration** :

```typescript
export interface FrontendModule {
  id: string;                        // "menus", "shop", "quests"
  displayName: string;                // "Menus", "Shop System"
  schemaVersion: string;              // "menu/v1", "shop/v1"
  
  // UI integration
  sidebar: { icon: ComponentType; label: string };
  routes: { path: string; component: ComponentType }[];

  // Document kinds this module contributes (ADR extensible-document-kinds, lot 5)
  documents?: DocumentKindContribution[];
  
  // WebSocket message types this module handles
  wsMessageTypes?: string[];
  
  // Optional: lifecycle hooks
  onMount?: () => void;
  onUnmount?: () => void;
}
```

**Registration** dans `editor/src/modules/index.ts` :

```typescript
import menusModule from './menus';
import commandsModule from './commands';
import shopModule from './shop';  // V1.5+

export const modules: FrontendModule[] = [menusModule, commandsModule, shopModule];
```

Le core charge ce registry au boot, monte les routes, register les WS handlers, ajoute les entrées sidebar.

> **SDK barrel (depuis 2026-06-15)** — le contrat `FrontendModule` + le registre + l'event bus sont exposés via un point d'entrée unique `@artisan/editor-sdk` (alias interne `editor/src/sdk/index.ts`). Les modules importent **uniquement** depuis ce barrel, jamais depuis `@/modules/api/...` en profondeur. En M1 c'est un re-export interne (pas encore un package npm publié) ; cf. `docs/superpowers/specs/2026-06-15-modules-architecture-design.md`. Les modules core menus/commands consomment déjà le barrel (dogfooding).

> **Vue de Config screen (depuis 2026-10-19, SDK 1.6)** — `screens: Record<string, ComponentType<ConfigScreenProps>>`.
> Un écran déclaré côté plugin avec `component` (`api.getScreens().declare(…, component)`) rend la
> vue de cette clé à la place du formulaire généré ; l'hôte garde la lecture, l'enregistrement,
> l'onglet YAML et l'historique. Pour une config singleton (récompenses quotidiennes), la racine est
> enregistrée par `registerConfig` : versionnée, hors de la liste des Projects (ADR
> `module-config-screens`, amendement 2026-10-19).

> **Dossier du module (depuis 2026-10-19, API 2.8.0)** — `api.getProjectRoots().moduleFolder(folder, moduleId, legacyDir)`
> donne au module `plugins/Artisan/modules/<folder>/`, enregistré comme une racine d'add-on (clé
> `addon:<folder>`, non renommable). L'ancienne racine (`legacyDir`) y est déplacée une fois ; le
> module lit ensuite ses fichiers dans le dossier renvoyé. À appeler dans `onEnable`, avant
> d'écrire un fichier par défaut.

> **Kinds de Document (depuis 2026-10-15, lot 5)** — un module contribue ses kinds de Document par
> `documents: DocumentKindContribution[]` : `kind`, `dir`, `schemaVersion`, `idPrefix?`, `label`,
> `icon?`, `component` (vue du panneau Propriétés), `title?`, `listByTitle?`, `create`, `parse`,
> `serialize`, `ltextSites?`, `chainSlots?`, `board?` (`size`, `summary`, `render` react-konva,
> aperçu non interactif, `items` : lignes sélectionnables, SDK 1.2, avec `marker` et `hover` en 1.5 ;
> `accent`, SDK 1.5). L'hôte l'installe à l'enregistrement (`registerEditorModule`,
> `lib/moduleDocumentKinds.ts`) dans sa table des kinds, ses codecs et ses visiteurs ; le panneau,
> les listings, la recherche, la planche, les traductions et les arêtes le lisent par le registre
> SDK (`documentKindContribution(kind)`). Les kinds core sont déclarés ainsi
> (`src/modules/{menus,commands,dialogs}/*Kind.tsx`). Un kind contribué par deux modules est refusé.
> **Ajouter un kind** : écrire la contribution dans `src/modules/{id}/{kind}Kind.tsx`, la lister
> dans la `FrontendModule`, un test de bout en bout sur le modèle de
> `lib/moduleDocumentKinds.test.tsx` (kind « quest »). Le plugin ne connaît pas encore les kinds de
> module (W6, après un pilote) : le dossier n'est pas synchronisé tant que `DocumentKinds.kt` ne le
> liste pas. Détail : `docs/architecture/editor-internals.md`, « Kinds de Document contribués ».

### 3.2 Backend module (supprimé en phase F)

> Plus de backend : un module n'a plus de routes ni de tables côté serveur web. Ce que le hub sait d'un module vient du `hello` (`installed_modules`, `data_sources`, `declared_models`, `editor_screens`) ou d'un appel direct au plugin. Section gardée pour l'historique.

```
/backend/src/modules/{module_id}/
  index.ts          ← Module registration
  routes/           ← Fastify route handlers
  schemas/          ← JSON schemas
  validators/       ← Validation logic au-delà de JSON Schema
  storage/          ← Drizzle schemas pour les tables du module
  sync/             ← WebSocket message handlers
```

**Interface de registration** :

```typescript
export interface BackendModule {
  id: string;
  schemaVersion: string;
  
  // REST routes à monter sous /api/modules/{id}/...
  registerRoutes(fastify: FastifyInstance): void;
  
  // Drizzle tables propres au module
  tables: PgTable[];
  
  // WebSocket message handlers
  wsHandlers?: Record<string, (msg: any, ctx: WsContext) => void>;
  
  // Data sources exposés par ce module (cf. section 4)
  dataSources?: DataSourceDeclaration[];
  
  // Commands exposés par ce module (cf. section 4)
  commands?: CommandDeclaration[];
}
```

> **SDK barrel (depuis 2026-06-15)** — le contrat `BackendModule` + l'intégrateur `mountModules` sont exposés via un point d'entrée unique `@artisan/backend-sdk` (path tsconfig interne `backend/src/sdk/index.ts`, résolu nativement par Bun y compris sous `bun test`). Les modules importent **uniquement** depuis ce barrel, jamais depuis `../modules/api/...`. En M1 c'est un re-export interne (pas encore un package npm publié) ; cf. `docs/superpowers/specs/2026-06-15-modules-architecture-design.md`. Les modules core menus/commands/assistant consomment déjà le barrel (dogfooding).

### 3.3 Plugin Paper : architecture multi-plugins

**Important** : côté Minecraft, on **n'a PAS un seul plugin monolithe**. On a un **plugin core** + **un plugin par Add-on** (module distribué séparément). Côté serveur l'admin install ce dont il a besoin :

- `artisan` (core) — **obligatoire**, gratuit, contient les modules indissociables du runtime (menus, commands, i18n, asset management, WebSocket sync, registries publics).
- `artisan-shop` (V1.5+) — premium, dépend du core, ajoute le module shop.
- `artisan-quests` (V2) — premium, dépend du core.
- `artisan-kits` (V2) — premium, dépend du core.
- etc.

C'est le pattern Vault / PlaceholderAPI / WorldGuard — bien connu et accepté du marché MC.

Le core prête aussi l'**infrastructure** aux Add-ons : `api.database.dataSource(plugin)` donne
un pool de connexions propre à l'Add-on, identifiants réglés une fois par l'admin dans
`plugins/Artisan/environment.yml` (ADR `suite-foundation-database`). Un Add-on n'embarque ni
driver ni config SQL ; il garde sa couche d'accès et ses migrations, et nomme chaque table,
index et contrainte `api.database.tablePrefix("<module>") + nom` (`artisan_<module>_…` par défaut).

#### 3.3.1 Plugin core

```
artisan-core/
  src/main/kotlin/net/artisanmc/core/
    ArtisanCorePlugin.kt              ← Main plugin class
    api/
      ArtisanAPI.kt                    ← Public API surface (versioned)
      ArtisanModule.kt                 ← Interface modules
      DataSourceDeclaration.kt
      CommandDeclaration.kt
    engine/
      MenuRenderer
      CommandExecutor
      MiniMessageEngine
      I18nResolver
    registries/
      DataSourceRegistry                  ← Public, lookup "namespace:source"
      CommandRegistry
      SchemaRegistry
      ModuleRegistry
    sync/
      WebSocketClient                     ← Connection au hub du réseau (feuille)
    storage/
      FilesystemMenuProvider
      CloudMenuProvider
    modules/
      menus/                               ← Module menus interne au core
      commands/                            ← Module commands interne au core
      i18n/                                ← Module i18n interne au core
      dialogs/                             ← Module dialogs interne au core (Paper 1.21+ Dialog API)
```

Les **modules indissociables du runtime** (menus, commands, i18n, dialogs) **vivent dans le core**. Un admin qui install seulement le core a déjà tout pour designer des menus et commandes.

#### 3.3.2 Plugin Add-on (ex: shop)

```
artisan-shop/
  plugin.yml
    name: ArtisanShop
    depend: [Artisan]                    ← Bukkit force le chargement du core d'abord
    api-version: 1.21
    main: net.artisanmc.shop.ShopPlugin
  src/main/kotlin/net/artisanmc/shop/
    ShopPlugin.kt                          ← extends JavaPlugin
    ShopModule.kt                          ← implements ArtisanModule
    ShopExecutor.kt                        ← Handles /buy command
    ShopRepo.kt                            ← Items storage
    bootstrap/                              ← Ressources bundle (cf. section 5)
      manifest.json
      menus/, commands/, dialogs/, translations/, assets/
```

L'`onEnable()` :

```kotlin
class ShopPlugin : JavaPlugin() {
    companion object {
        const val MIN_CORE_API_VERSION = "1.0.0"
    }
    
    override fun onEnable() {
        val core = server.pluginManager.getPlugin("Artisan") as? ArtisanCorePlugin
            ?: return disableWithError("Artisan core not found. Install from artisanmc.net.")
        
        if (!core.api.isCompatibleWith(MIN_CORE_API_VERSION)) {
            return disableWithError(
                "Artisan Shop ${description.version} requires Artisan core $MIN_CORE_API_VERSION+. " +
                "Current API: ${core.api.apiVersion}."
            )
        }
        
        val module = ShopModule(this, core.api)
        core.api.modules.register(module)
        
        // Bootstrap si première install sur ce serveur
        if (!core.api.project.hasContent("shop")) {
            core.api.bootstrap.unpack("shop", loadBootstrapBundle())
        }
    }
}
```

#### 3.3.3 Interface module

```kotlin
interface ArtisanModule {
    val id: String                          // "menus", "shop", "quests"
    val schemaVersion: String                // "shop/v1", "quest/v1"
    
    fun onEnable(api: ArtisanAPI)         // Register data sources, commands, listeners
    fun onDisable()                         // Cleanup
    fun onReload()                          // Hot-reload de la config
}
```

Depuis l'API 1.8.0, `onDisable()` est appelé quand le plugin qui a chargé le module se désactive (`PluginDisableEvent`, avant son propre `onDisable`), et tout ce que ce plugin a enregistré (modules, data sources, commandes) est retiré : un rechargement de plugin peut ré-enregistrer les mêmes ids. `ModuleRegistry.unregister(id)` fait la même chose à la demande.

#### 3.3.4 Avantages du split plugins

1. **Admin onboarding léger** : install seulement ce dont tu as besoin. Le core gratuit fait beaucoup tout seul.
2. **Monétisation clean** : chaque Add-on = son propre .jar = sa propre vente (SpigotMC Premium, BBV, Polymart). Pas de license key gating.
3. **Discoverability** : recherche *"shop plugin"* sur SpigotMC → ton plugin shop apparaît. Pas caché derrière un parent.
4. **Versioning indépendant** : ship shop 1.5 sans toucher au core.
5. **Pattern familier** au marché MC (Vault, PlaceholderAPI, WorldGuard).

#### 3.3.5 Backend reste monolithique (historique)

> Depuis la phase F, c'est le hub qui lit `installed_modules` au `hello` (ou directement dans le plugin pour le serveur `local`) et l'éditeur qui filtre son UI selon ces modules.

Le backend (Fastify) et l'éditeur web restent **un seul deployment chacun**. Au WebSocket handshake, le plugin core déclare les modules installés sur le serveur :

```json
{
  "type": "hello",
  "server_key": "...",
  "core_version": "1.5.2",
  "installed_modules": [
    { "id": "menus", "version": "1.5.2" },
    { "id": "commands", "version": "1.5.2" },
    { "id": "shop", "version": "1.0.3" }
  ]
}
```

L'éditeur filtre son UI selon ces modules. Les modules non installés sont **affichés en grisé avec un *"Install Artisan Shop to use this module"*** + link vers SpigotMC Premium / BBV.

## 4. Composition : data sources + commands

Les modules **ne se connaissent pas directement**. Ils communiquent via deux primitives universelles : **data sources** et **commands**.

### 4.1 Data sources

Un data source expose des données typées d'un module à tous les autres. Format : `namespace:source_id`.

Exemples :
- `shop:items` → liste des items du shop
- `shop:categories` → liste des catégories
- `quests:available` → liste des quêtes dispos pour un joueur
- `kits:available` → liste des kits dispos
- `essentials:warps` → liste des warps (via la data source EssentialsX)

**Le module menus consomme** des data sources via le champ `data_source.ref` de ses Elements (cf. main-spec section 14). Le menus module ne sait pas ce qu'est un "shop item" — il sait juste itérer une liste avec des champs typés.

**Le module shop expose** son data source via `ArtisanAPI.dataSources.register(...)` :

```kotlin
class ShopModule : ArtisanModule {
    override fun onEnable(api: ArtisanAPI) {
        api.dataSources.register(DataSourceDeclaration(
            ref = "shop:items",
            schema = ShopItemSchema,        // shape des objets retournés
            fetcher = { player, params -> shopRepo.getItems(player, params) }
        ))
    }
}
```

Le `schema` est une `List<DataSourceField>` dont chaque champ est typé par un `ModelFieldType` (`new DataSourceField("price", ModelFieldType.number())`) : le même vocabulaire que les Data models (`api.getModels().declare(new ModelDeclaration(...))`) et les arguments d'action. `FieldKind` reste accepté, `@Sunset` jusqu'à 3.0.0.

Au runtime, quand le module menus rend un Element avec `data_source.ref = "shop:items"`, le `DataSourceRegistry` route la requête au shop module qui retourne la data. Zéro couplage direct.

### 4.2 Commands

Pareil pour les commands. Chaque module expose ses actions invocables.

Exemples :
- `shop:buy` → acheter un item
- `quests:complete` → complete une quête
- `kits:claim` → réclamer un kit

**Référencé depuis n'importe quel menu** :

```json
{
  "click": {
    "left": {
      "actions": [
        { "type": "run_command", "command": "shop:buy {data.id}" }
      ]
    }
  }
}
```

**Enregistré par le module qui owns** :

```kotlin
api.commands.register(CommandDeclaration(
    name = "shop:buy",
    handler = { player, args -> shopExecutor.handleBuy(player, args) }
))
```

### 4.2 bis Commandes joueur (API 2.7.0)

Distinctes des commands ci-dessus, que seul un menu appelle : une **commande joueur** est tapée en
jeu. Le module déclare le comportement avec un id stable, l'admin habille le reste par un fichier
`command_override/v1` du dossier `overrides/command/` d'un project (nom et alias de la racine,
permission, cooldown, conditions, textes par langue, désactivation). Pas de suppression : la
commande existe tant que le module est chargé.

Chaque commande de module (sous-commandes comprises) a son fichier : au chargement et quand un
module arrive, le plugin écrit celui qui manque dans le premier dossier du module, `schema` et
`command` seuls, les valeurs du module en commentaires (`CommandOverrideStore.seed`, avec les
templates, puis rechargement). Jamais de vraies clés, qui figeraient les valeurs du module à sa
prochaine version ; jamais un fichier remplacé, ni un override doublé s'il vit dans un autre dossier.

L'id, les arguments et les sous-commandes restent ceux du module : son code les lit. `steps`
(chaîne d'actions, comme `command/v1`) remplace le code du module, sur la racine comme sur une
sous-commande ; les arguments analysés y sont les valeurs `{nom}`, et un id de menu nu se résout
dans le dossier de l'override. L'action `module_command` (`command`, `args`) lance le code d'origine
d'une commande de module depuis une chaîne, sans son override (ni conditions, ni cooldown, ni
`steps` : pas de boucle), permission vérifiée et arguments typés comme à la saisie ; elle marche
aussi pour une commande désactivée. Elle est déclarée comme une action de module (propriétaire
`artisan`) : l'éditeur construit son formulaire depuis la déclaration.

Une commande qui ne fait qu'ouvrir un menu le déclare par `opensMenu("dossier:menu")` (API 2.11.0)
au lieu d'un exécuteur : Artisan ouvre le menu, les arguments en contexte, et la planche de l'éditeur
dessine le lien. Un `steps` d'override la remplace comme un exécuteur, et `module_command` rouvre le
menu déclaré.

```yaml
schema: command_override/v1
command: guilds:balance.add
steps:
  - open_menu: confirmer_depot        # le menu reçoit {amount} par son entrée de contexte
# dans le bouton « Confirmer » du menu :
#   - module_command: { command: guilds:balance.add, args: { amount: "{amount}" } }
```

```java
api.getPlayerCommands().register(PlayerCommandDeclaration.builder("quests:track")
    .name("track")
    .argument(CommandArgument.string("quest"))
    .executor(ctx -> tracker.track(ctx.getPlayer(), ctx.get("quest", String.class)))
    .build());
```

`CommandRegistrar` les enregistre après les `command/v1` des projects (un nom déjà pris laisse
`/<module>:<nom>`) et renvoie l'arbre de commandes aux joueurs connectés quand il change. Contrat
détaillé : `api-surface.md`.

### 4.3 Avantages du pattern

- **Découplage** : le module menus n'a aucune dépendance sur shop, quests, etc.
- **Extensibilité** : ajouter un module = ajouter ses data sources/commands au registry. Aucun module existant ne doit être modifié.
- **Testabilité** : chaque module peut être testé isolément en mockant le registry.
- **Compatibilité plugins tiers (V2+)** : un plugin tiers peut s'enregistrer dans le même registry et devenir une data source / command disponible à tous les modules.

### 4.4 Actions (ADR `extensible-document-kinds`, R1 — API 2.0.0)

Une **action** est un verbe d'une chaîne (`click`, `steps` d'une commande, bouton de dialog) : `- name`,
`- name: valeur`, `- name: {args}` (ADR `structured-action-wire`). Toute action, celles d'Artisan comprises
(`open_menu`, `give_item`…), passe par `api.getActionRegistry()` : le step du moteur est un nom et une
valeur, le registre nomme le handler, la déclaration lie la valeur aux arguments déclarés (défauts
compris), le handler s'exécute. Un nom que personne ne déclare est ignoré avec un avertissement.

**Déclaré par le module qui owns** (dans `onEnable`, retiré avec le module) :

```java
api.getActionRegistry().register(new ActionDeclaration(
    "quests:start",
    List.of(
        new ModelField("quest", ModelFieldType.documentRef("quest"), true),
        new ModelField("silent", ModelFieldType.bool()).withDefault(false)),
    "quest",                                   // `- quests:start: intro` lie `quest`
    (ctx, args, runtime) -> {
        quests.start(ctx.getPlayer(), (String) args.get("quest"), Boolean.TRUE.equals(args.get("silent")));
        return ctx;                            // ou ctx.withArgs(Map.of("quest_started", ...)) pour la suite de la chaîne
    }));
```

`ActionRuntime` prête au handler ce que le moteur sait faire : `text(ctx, ltext)` (langue du joueur,
`{i18n:key}`, placeholders, PlaceholderAPI), `run(ctx, chaîne)` (un argument `actions`), `warn`.
Les arguments sont des `ModelField` typés (`ModelFieldType`, dont `document_ref(kind)`) : l'éditeur en
rend le formulaire et les propose dans le sélecteur de step dès que le serveur les a rapportés
(`declared_actions` à la Presence, `GET …/actions`). Les actions core sont déclarées de la même façon
(`CoreActions` dans `core`, handlers dans `paper`), verrouillées sur `docs/schema/menu/v1/schema.json`.

### 4.5 Kinds de Document (ADR `extensible-document-kinds`, W6 — API 2.1.0)

Un module qui possède un **kind** de Document (une quête, une boutique…) le déclare dans `onEnable`,
par la même porte que ses actions ; le kind est retiré avec le module :

```java
api.getDocumentKinds().register(new DocumentKindDeclaration(
    "quest",                 // kind : clé de `documents[kind]`, ^[a-z][a-z0-9_]*$
    "quests",                // dossier dans un project, ce qui dit le kind d'un fichier sur disque
    List.of("quest/v1"),     // labels `schema:` lus ; le premier est canonique
    "quest_"));              // préfixe des ids neufs côté éditeur (optionnel)
```

Menu, command et dialog sont déclarés de la même façon par le core (`DocumentKinds.coreRegistry()`) :
un seul registre, un seul chemin. Deux kinds ne partagent ni id ni dossier
(`DuplicateDocumentKindException`).

Ce qu'Artisan fait d'un kind déclaré : lire ses fichiers au chargement du project comme **documents
bruts** (le mapping YAML tel quel, le nom du fichier pour `id`, `schema:` vérifié contre les labels
déclarés — un label inconnu est une erreur de rechargement, comme pour un kind core), les lister dans
l'inventaire de ressources, les rapporter à la Presence (`document_kinds`, `GET …/document-kinds`) et les
rendre au module par `api.getProject().documents(projectId, "quest")` (`List<Map<String, Object>>`,
instantané du dernier chargement — à relire dans `onReload()`). Ce qu'un Document de ce kind **fait**
reste au module : Artisan ne dispatch rien pour lui, le module lit ses maps et agit (ses actions
`quests:start`, ses commandes, ses listeners).

Côté éditeur, le module jumeau contribue le même kind (`FrontendModule.documents`, §3.1 et
`editor-internals.md`). Les deux déclarations sont indépendantes : l'éditeur signale un kind que le
serveur actif ne liste pas (le fichier serait écrit dans un dossier que rien ne lit là-bas) dans
l'arbre du project et au moment de créer un Document de ce kind.

Une chaîne stockée dans un Document du module (récompenses d'une quête) s'exécute sous sa forme
keyed par `api.getActions().run(player, chain, args, projectId)` (API 2.2.0) ; `execute` reste pour
la chaîne DSL legacy.

### 4.6 Conditions hors chaîne (API 2.2.0)

Un module qui a ses propres prérequis (une quête démarrable sous condition) les écrit dans le
vocabulaire des conditions d'Artisan et les évalue sans chaîne :

```java
List<?> requirements = (List<?>) quest.get("requirements");   // [{has_level: 10}, {has_permission: quests.vip}]
List<String> problems = api.getConditions().validate(requirements);   // au chargement : à journaliser
boolean ok = api.getConditions().test(player, requirements, Map.of("completed", done));
```

Même évaluateur que `if:`, lecture **stricte** : une condition inconnue ou mal formée rend `test`
faux (avertissement unique) au lieu d'être ignorée comme dans un menu. À appeler sur le thread qui
possède le joueur (`IllegalStateException` sinon). Détail : `api-surface.md`.

### 4.6 bis Messages système traduits (API 2.5.0)

Un plugin de la suite ne refait pas son système de lang : il enregistre ses fichiers sous son
namespace et Artisan choisit la langue du joueur, gère les replis et rend le MiniMessage :

```java
MessageBundle messages = api.getTranslations().register(
    MessageBundleDeclaration.files(this, "quests", "en", "fr"));   // jar lang/<code>.yml + plugins/<Plugin>/lang/
player.sendMessage(messages.get(player, "quest.tracked", Map.of("quest_name", name)));
```

Les valeurs des placeholders (`<name>`, `{name}`, `%name%`) sont insérées comme du texte. Un plugin
qui garde ses propres fichiers passe un `MessageSource` (`MessageBundleDeclaration.of`). Détail :
`api-surface.md`.

### 4.7 Module editor bundle (level 3) — API 2.3.0, protocole 1.2

Un add-on (ArtisanQuests…) peut livrer la **vue éditeur** de son module dans son propre jar, au lieu
d'attendre une release de l'éditeur : un script ES module construit contre `@artisan/editor-sdk`.
Il l'enregistre dans `onEnable`, un seul par module, retiré avec le module :

```java
api.getEditorBundles().register(
    EditorBundleDeclaration.fromResource(getClass().getClassLoader(), "artisan-editor/ui.js", "1.0"));
```

- `EditorBundleDeclaration(script, sdk)` : script UTF-8 non vide, ≤ 4 MiB ; `sdk` = version du SDK
  visée, `MAJOR.MINOR[.PATCH]` ; `getHash()` = SHA-256 hex. Hors `onEnable` : `IllegalStateException` ;
  un second bundle pour le même module : `DuplicateEditorBundleException`.
- **Presence** : l'entrée `installed_modules` du module porte `editor_bundle: {sdk, hash, size}`
  (`ws-protocol.md`) ; un bundle enregistré ou retiré après le `hello` part au `modules_changed` suivant.
- **Servi** par le hub : `GET /api/v1/servers/:server/modules/:module/ui.js?v=<hash>`
  (`rest-endpoints.md`) ; le hub va le chercher au serveur (`editor_bundle_fetch`), vérifie le hash,
  le garde en mémoire par hash, et le sert `immutable` quand `v` égale le hash.
- **Développement** : `dev.editor-bundles.<module>: <chemin de ui.js>` dans `environment.yml` (jamais
  écrit par l'éditeur : personne ne peut lui faire servir un fichier du serveur) sert ce fichier à la
  place du bundle du jar, avec la version SDK de ce dernier. `LocalEditorBundles` le relit à chaque
  changement (vérifié chaque seconde) et une feuille envoie `modules_changed` ; l'entrée porte
  `editor_bundle.local: true`. Fichier absent ou invalide : bundle du jar, avec un avertissement.
- **Chargé** par l'éditeur contre le SDK qu'il embarque : `editor-internals.md` §« Runtime module
  bundles ».

### 4.8 Modèles de module — API 2.6.0, protocole 1.3

Un module livre du **contenu d'exemple** copiable dans n'importe quel Project (ADR `module-templates`) :
un modèle = des fichiers de Project (Documents, menus, `lang/`… jamais `manifest.yaml`, propre à chaque Project) lus dans son jar, une version qu'il
monte à chaque changement, un Project d'amorçage facultatif.

```java
api.getTemplates().register(TemplateDeclaration
    .fromResources(getClass().getClassLoader(), "artisan-templates/daily", "daily", 1,
        List.of("quest_groups/daily.yaml", "menus/quests_daily.yaml"))
    .title("Daily quests")
    .seed("quests")
    .build());
```

- **Presence** : `installed_modules[].templates` = `[{id, title, version, seed_project?, files:[{path, hash, size}]}]`, sans contenu.
- **Lire** (version par défaut, lecture seule) : `GET SERVER/modules/:module/templates/:template` (`template_fetch`).
- **Copier** : `POST …/projects/:project/templates` `{module, template, paths?, replace}` (`template_copy`) ;
  un fichier déjà présent au contenu différent n'est jamais écrasé sans `replace` (409 `conflict` + `conflicts`).
  Chaque fichier copié est tracé dans `.artisan/origins.yaml` ; `GET …/projects/:project/origins` les lit.
- **Amorçage** : un modèle avec `seed(projectId)` est copié une seule fois dans un nouveau Project de ce
  nom (`.artisan-seeds.yaml` à la racine core), avec un manifest dans la langue du serveur, jamais
  recréé si le propriétaire le supprime. Si ce nom est le dossier du module lui-même
  (`moduleFolder`, créé vide), les fichiers y sont copiés, avec le manifest s'il manque, sans
  écraser ce qui s'y trouve.
- **Éléments système** (API 2.12.0, design `framework-commandes` §3.8) : un modèle `.system()` porte
  les menus et dialogues que le code du module ouvre par id. Pas d'amorçage : à chaque démarrage et à
  l'arrivée du module, `SystemFiles` les garde dans le premier dossier du module par nom. Un fichier
  absent est réécrit (sauf si un fichier du même nom vit sous le même dossier de type ailleurs dans le
  module : déplacé), une copie intacte d'une version plus ancienne est remplacée, une copie modifiée
  reste celle de l'admin, son origine sur la version copiée (l'éditeur signale la nouvelle version).
  Un fichier présent avant que le module en fasse un élément système compte comme modifié. Copier un
  modèle système ailleurs que dans le dossier du module est refusé (`system_template`) : dans ce
  dossier, c'est une réinitialisation. L'éditeur ne le propose pas à la copie.

```java
api.getTemplates().register(TemplateDeclaration
    .fromResources(getClass().getClassLoader(), "artisan-system", "menus", 3,
        List.of("menus/shop_main.yaml", "menus/shop_category.yaml"))
    .system()
    .build());
```

## 5. Module bootstrap : content bundles

> Vision d'origine. Réalisée par les modèles de module (§4.8) : pas de dialogue à l'installation,
> un amorçage unique et un catalogue dans l'éditeur ; le reste de cette section n'est pas implémenté tel quel.

Chaque module non-trivial **ship un bundle de contenu par défaut** qui sert de bootstrap quand l'admin installe le module pour la première fois. Ce bundle n'est PAS juste un menu — c'est un set complet de **toutes les ressources** dont le module a besoin pour fonctionner out-of-the-box.

### 5.1 Composition d'un bundle bootstrap

Un bundle peut inclure :

| Type | Schema | Exemple pour shop module |
|---|---|---|
| **Menus** | `menu/v1` | `shop_main`, `shop_category_tools`, `shop_confirm_buy` |
| **Commands** | `command/v1` | `/shop` (ouvre `shop_main`), `/buy <item>` (achète directement) |
| **Dialogs** | `dialog/v1` | Confirmation d'achat, messages d'erreur (Paper 1.21+ Dialog API) |
| **Translations** | `translations/v1` | Clés `shop.title`, `shop.bought_success`, `shop.not_enough_money`, ... en FR + EN par défaut |
| **Templates** | `template/v1` | Bouton d'achat réutilisable, header de catégorie standard |
| **Assets** | PNG/JSON | Icônes par défaut, textures optionnelles |
| **Default config** | `{module}/v1` | Quelques items exemples pour démarrer (diamant à 100, apple à 5...) |

### 5.2 Format du bundle

Bundle = un dossier dans `/plugin/resources/modules/{module_id}/bootstrap/` packagé avec le `.jar` :

```
plugin/src/main/resources/modules/shop/bootstrap/
  manifest.json              ← Liste des resources, dependencies
  menus/
    shop_main.json
    shop_confirm_buy.json
  commands/
    shop.json
    buy.json
  dialogs/
    confirm_purchase.json
  translations/
    shop_keys.json           ← Clés i18n avec valeurs FR + EN
  templates/
    buy_button.json
  assets/
    shop_icon.png
  config/
    sample_items.json        ← Items démo
```

### 5.3 Manifest du bundle

```json
{
  "module_id": "shop",
  "schema_version": "shop/v1",
  "menus": ["shop_main", "shop_confirm_buy"],
  "commands": ["shop", "buy"],
  "dialogs": ["confirm_purchase"],
  "translations": "shop_keys.json",
  "templates": ["buy_button"],
  "assets": ["shop_icon.png"],
  "default_config": {
    "items": "sample_items.json"
  }
}
```

### 5.4 Flow d'installation

Quand l'admin install le shop module (V1.5+) :

1. Le module détecte qu'il n'y a pas encore de config shop dans le project.
2. Il propose un dialog *"Welcome to Shop module. We'll create some sample content to get you started — you can customize or delete it anytime. [Create] [Skip and configure from scratch]"*.
3. Click **Create** → le bundle bootstrap est unpacké dans le project :
   - Les menus arrivent dans `/menus/` (éditables via le module menus)
   - Les commandes arrivent dans `/commands/` (éditables via le module commands)
   - Les dialogs arrivent dans `/dialogs/` (éditables via le module dialogs)
   - Les clés i18n sont mergées dans `translations.json` du project
   - Les templates et assets sont ajoutés à la library
   - Les items exemples sont créés dans la config shop
4. L'admin a immédiatement un shop fonctionnel qu'il peut éditer pièce par pièce.

### 5.5 Édition post-bootstrap

**Une fois unpackées, ces resources sont des entités standard du project.** Le menu `shop_main` est un menu comme un autre, éditable dans le module menus. La commande `/shop` est éditable dans le module commands. Les translations sont éditables dans la section i18n.

Le shop module **continue à fonctionner même si l'admin renomme/modifie/supprime ces resources** — il référence par id (qui peut être remappé dans la config du module).

### 5.6 Re-bootstrap et resets

Bouton *"Reset to default"* dans la UI du shop module : re-ship le bundle bootstrap par-dessus l'existant (avec confirmation). Utile si l'admin a tout cassé.

### 5.7 Cross-module dependencies

Un module peut **dépendre des resources d'autres modules** lors du bootstrap. Exemple : le module quests pourrait dépendre de `translations/common` (clés génériques comme "Yes", "No", "Cancel"). Déclaré dans le manifest :

```json
{
  "module_id": "quests",
  "depends_on_modules": ["translations"],
  "shared_keys": ["common.yes", "common.no", "common.cancel"]
}
```

Le bootstrap résout les dépendances et utilise les keys existantes plutôt que de les dupliquer.

## 6. Cross-module navigation et UX

L'éditeur web a une sidebar globale avec une entrée par module. À l'intérieur de chaque module, l'UX est **owned par le module** :

- **menus** : sidebar des menus + canvas multi-menu (toggle) + focused editor avec layers
- **commands** : table des commandes + form-based editor
- **shop** (V1.5) : table des items + form-based editor + section "Menus using this shop"
- **quests** (V2) : graph/timeline editor pour les chaînes de quêtes
- **kits** (V2) : table des kits + form-based editor

Les modules **se référencent mutuellement via des deeplinks** :

- Dans le shop module : *"Edit shop menu →"* link vers `/menus/{shop_main_menu_id}`
- Dans le quest module : *"Edit quest list menu →"* link vers `/menus/{quest_list_menu_id}`
- Dans le menus module, quand un Element a `data_source: shop:items`, un small badge *"Data from Shop module — Configure →"* link vers `/shop`

Cross-linking, pas embedding. Chaque module reste owner de sa propre UX.

## 7. Versioning et migrations

Chaque module a son schema versionné indépendamment :

- `shop/v1` → `shop/v2` (breaking change)
- `quests/v1` → `quests/v2`

`menu` en est resté à `v1` : `menu/v2` et `menu/v3` ont existé six jours sans
transformer une seule donnée et ont été repliés (cf. `schemas-codegen.md`).

Le **plugin Paper et le web editor migrent au load** d'un schema antérieur vers le current. Pattern :

```kotlin
class ShopModule : ArtisanModule {
    override val schemaVersion = "shop/v2"
    
    fun loadCatalog(json: JsonObject): Catalog {
        val version = json["schema"].asString
        return when (version) {
            "shop/v1" -> migrateV1ToV2(json)
            "shop/v2" -> parseV2(json)
            else -> throw UnsupportedSchemaVersionException(version)
        }
    }
}
```

Les migrations sont write-once, jamais modifiées après ship. Forward-compatibility garantie.

## 8. Form generator from schema (le multiplicateur)

Pour la majorité des modules, l'UI de config est **form-based** : des champs typés, des dropdowns, des listes, des inputs avec validation. Pas besoin de réinventer ça pour chaque module.

Le core fournit `<SchemaForm>` qui prend un JSON Schema et génère automatiquement un formulaire React fonctionnel :

```tsx
import { SchemaForm } from '@/core/ui';
import shopItemSchema from '@/modules/shop/schemas/item.v1.json';

<SchemaForm
  schema={shopItemSchema}
  value={item}
  onChange={updateItem}
  // Custom widgets pour types spéciaux
  widgets={{
    material: MaterialPicker,
    price: PriceInput,
    icon: AssetPicker,
  }}
/>
```

**Implémentation** : soit `@rjsf/core` (React JSON Schema Form), soit ton propre générateur (~500-1000 lignes, mieux intégré au design system).

**Custom widgets** : pour les types qui méritent un widget visuel (color picker, asset picker, MiniMessage editor, item material selector, etc.), tu register des widgets custom une fois et tous les modules en bénéficient.

**80 % des modules** seront codés en quelques heures grâce à ce pattern : tu déclares ton schema, le form est généré, tu register tes data sources / commands, fin.

**20 % des modules** auront besoin d'UX custom (le menus module avec son canvas, le quest module avec son graph editor, etc.). Là tu écris du React custom dans `/modules/{id}/editor/`.

## 9. Phasing V1 → V3

### V1 (launch, semaines 3-8)

Modules livrés :
- `menus` — menu editor visuel (le focus principal)
- `commands` — éditeur de commandes
- `translations` — i18n keys (intégré dans menus + commands)

Pattern d'architecture en place :
- `ArtisanModule` interface (Java depuis l'API 2.0.0) côté plugin
- `BackendModule` / `FrontendModule` interfaces côté web
- `DataSourceRegistry` + `CommandRegistry` opérationnels
- 5 data sources homemade (EssentialsX, ChestShop, JobsReborn, LuckPerms, Quests) — ce sont déjà des modules read-only en pratique

### V1.5 (M+2 à M+4)

Premier Add-on : **boutique** (nom final du module `shop` de la spec — livré, cf. §15).
- Schema `boutique/v1` avec items, categories, prices
- Plugin externe (repo séparé, dépend du core) — pas de backend Fastify/Drizzle dédié : le catalogue vit dans `boutique/shop.yaml`, synced comme n'importe quel fichier de project
- Frontend `@artisan/boutique-editor` form-based (presence-gated `/m/boutique`)
- Templates menus `shop_main` / `shop_category` bootstrappés
- Data sources `boutique:categories` / `boutique:items`, command `boutique:buy`
- Ce module boutique est **le proof of concept livré** du pattern modulaire en plus du menu editor — avec des écarts vs la spec, documentés en §15.

### V2 (M+4 à M+8)

Ajout des modules :
- `quests` — chaînes de quêtes, objectives, rewards
- `kits` — items, cooldowns, permissions
- `warps` — locations
- `profiles` — player profile menus

Each module = ~1-2 semaines de dev grâce au pattern bien établi.

### V3+ (M+9+)

Ouverture du **SDK pour modules tiers** :
- Documentation publique du pattern `ArtisanModule`
- NPM package `@artisan/sdk` pour le frontend
- Maven artifact `net.artisanmc:sdk` pour le plugin
- Validation et publication via Artisan (review process)
- Marketplace de modules tiers (commission 15-30 %)

Le SDK n'est ouvert que quand tu as :
1. Au moins 5 modules built par toi (validation du pattern)
2. Demande validée par des 3ᵉ party developers (Discord, Reddit, contacts directs)
3. Capacité opérationnelle pour reviewer + supporter les modules tiers

## 10. Implications V1 immédiates

Si tu valides cette architecture, voici les ajouts à intégrer dans les 2-3 semaines V1 :

### Plugin (Kotlin)

- Interface `ArtisanModule` (~30 lignes)
- Classes `DataSourceRegistry` et `CommandRegistry` (~100 lignes chacune)
- `ArtisanPlugin` charge un registry de modules au `onEnable()`
- `MenusModule` créé comme premier module (encapsule ce qui existe déjà)
- `CommandsModule` créé comme second module
- 5 data sources (EssentialsX, ChestShop, etc.) deviennent des sous-modules de leur namespace, enregistrés dans `DataSourceRegistry`

**Effort : ~2-3 jours** de refactor opportuniste. Le code de rendu menus existe déjà — tu le **wrapes** dans la classe `MenusModule`.

### Backend (Fastify) — supprimé en phase F

- Interface `BackendModule` (~30 lignes)
- Module registry au boot
- Refactor des routes existantes en `/api/modules/menus/*` (à terme — tu peux garder `/api/menus/*` pour V1 et migrer plus tard si tu veux)

**Effort : ~1-2 jours** de refactor opportuniste.

### Frontend (React)

- Interface `FrontendModule` (~30 lignes)
- Module registry chargé au boot dans `App.tsx`
- Sidebar dynamique (lit le registry pour les entrées)
- Routes dynamiques (charge les routes de chaque module)
- Composant `<SchemaForm>` (à coder ou intégrer rjsf) — utile dès V1 pour des configs simples, indispensable V1.5+

**Effort : ~3-5 jours** dont 2-3 jours sur `<SchemaForm>` qui sera réutilisé pour TOUS les modules futurs.

### Total V1 add

**~6-10 jours de dev supplémentaires** pour mettre l'architecture en place. Compense largement le temps gagné sur tous les modules futurs (chacun gagnera 1-2 semaines grâce au pattern établi).

## 11. Ce qu'on NE fait PAS en V1

- Pas de dynamic module loading (les modules sont statiquement linkés)
- Pas de SDK public pour 3ᵉ party developers
- Pas de marketplace de modules
- Pas de isolation runtime (les modules tournent dans le même process Java)
- Pas de quota / billing per-module

Ces features arrivent **incrémentalement** quand le besoin émerge.

## 12. Risques connus

- **Over-engineering** : ajouter le pattern modulaire pour 2 modules au launch (`menus`, `commands`) peut sembler overkill. Réponse : c'est ~1 semaine d'effort qui en économise 4+ par module futur. Investment rentable dès le 2ᵉ module ajouté.
- **Coupling subtil** : malgré la séparation, des modules peuvent finir par dépendre implicitement de la shape des data sources d'autres modules. Mitigation : `DataSourceDeclaration` inclut un JSON Schema typé, et le frontend valide la shape côté éditeur.
- **Hot-reload cross-module** : si le module shop est rechargé, les menus qui consomment `shop:items` doivent re-fetch. Pattern observer / event bus côté plugin core à implémenter (~1 jour V1).
- **Plugin version mismatch** : split en plusieurs plugins introduit le risque qu'un admin install core 1.0 + shop 2.0 incompatibles. Mitigation : SemVer strict, graceful failure, communication. Cf. section 13.

---

## 13. Compatibility et versioning multi-plugins

Avec le split core + plugins modules, la **compatibility entre versions** devient une discipline critique. Pattern à respecter :

### 13.1 SemVer strict sur l'API publique

L'API publique du core (`ArtisanAPI`, `ArtisanModule`, `DataSourceRegistry`, etc.) suit **SemVer strict** :

- **Patch (1.0.0 → 1.0.1)** : bug fixes uniquement. Aucun changement d'API. Modules existants continuent à marcher.
- **Minor (1.0.0 → 1.1.0)** : nouvelles features de l'API, **backward compatible**. Modules existants continuent à marcher.
- **Major (1.0.0 → 2.0.0)** : breaking changes. Modules peuvent ne plus marcher, doivent être updates.

**Règle d'or** : éviter les majors. Une par an max, idéalement aucune. Quand inévitable : annonce 3-6 mois à l'avance, modules updates ship en parallèle de la major core.

### 13.2 Module déclare sa compatibilité

Chaque plugin module déclare sa contrainte de version du core dans le code :

```kotlin
class ShopPlugin : JavaPlugin() {
    companion object {
        const val MIN_CORE_API_VERSION = "1.0.0"
        // Tout 1.x.y compatible (semver minor/patch backward compat)
    }
    
    override fun onEnable() {
        val core = pluginManager.getPlugin("Artisan") as? ArtisanCorePlugin
            ?: return disableWithError("Artisan core not found. Install from artisanmc.net.")
        
        if (!core.api.isCompatibleWith(MIN_CORE_API_VERSION)) {
            return disableWithError(
                "Artisan Shop ${description.version} requires Artisan core $MIN_CORE_API_VERSION or higher. " +
                "Current API: ${core.api.apiVersion}. " +
                "Update: https://www.spigotmc.org/resources/artisan/"
            )
        }
    }
    
    private fun disableWithError(msg: String) {
        logger.severe(msg)
        server.pluginManager.disablePlugin(this)
    }
}
```

### 13.3 Comportement en cas de mismatch

**Aucune force update automatique.** Le module fail gracefully avec un message explicite :

```
[Artisan Shop] ERROR: Artisan Shop 2.0.0 requires Artisan core 2.0.0+.
[Artisan Shop] Current Artisan core: 1.5.2.
[Artisan Shop] Update Artisan core: https://www.spigotmc.org/resources/artisan/
[Artisan Shop] Shop is disabled. Other plugins are not affected.
```

L'admin voit l'erreur claire dans les logs, sait quoi faire, a le choix (update core, downgrade module, désactiver). Ses autres plugins ne sont pas affectés. C'est **le même pattern que Bukkit/Spigot** pour les plugins incompatibles avec une version serveur.

### 13.4 API publique vs internals

**Stable (covered by SemVer)** :
- Interface `ArtisanAPI`
- Interface `ArtisanModule`
- Registries publics (`DataSourceRegistry`, `CommandRegistry`, `SchemaRegistry`, `ModuleRegistry`)
- Classes `DataSourceDeclaration`, `CommandDeclaration`
- Schemas versionnés (`menu/v1`, `command/v1`, `shop/v1`, etc.)
- Events publics : bus `ModuleEventBus` (`ConfigReloadEvent`, `DataReloadEvent`) ; événements Bukkit de menu `MenuOpenEvent`, `MenuClickEvent`, `MenuCloseEvent` (`@Beta`, API 1.8.0)

**Internals (les modules NE doivent PAS en dépendre)** :
- Implémentation interne du WebSocket client
- Parser MiniMessage interne
- Stratégies de storage
- Threading internals
- Classes marquées `@Internal` ou dans des packages `internal`

Documentation claire dans `docs/architecture/api-surface.md` (à créer V1) qui liste explicitement ce qui est public stable vs interne.

### 13.5 Communication aux admins

**Sur SpigotMC / Modrinth** :
- Page Artisan Core : changelog clair, breaking changes signalés en gras rouge.
- Pages des modules premium : *"Compatible avec Artisan core 1.x"* indiqué visiblement.

**Discord** :
- Channel `#announcements` pour les updates majeures.
- Notification quand une major est planifiée 3+ mois à l'avance.
- Beta access aux modules updates avant la release de la core major.

**Backend (artisanmc.net)** (supprimé en phase F ; le hub affiche « mise à jour requise » pour une majeure de protocole différente, cf. `versioning.md` §4) :
- Détecte les versions installées via WebSocket handshake.
- Affiche un warning dans l'éditeur web : *"Artisan Shop 1.0.0 is incompatible with Artisan core 2.0.0 (released 3 days ago). Update Shop to 2.0.0."*
- Email automatique aux Pro users quand un module qu'ils ont a une update disponible.

### 13.6 Stratégie pour les majors

Quand une major core est nécessaire (refactor architecture, breaking change Adventure, etc.) :

1. **3 mois avant** : annonce Discord + SpigotMC + roadmap publique. Spec des breaking changes.
2. **2 mois avant** : beta des nouvelles versions des modules premium aux Pro users.
3. **1 mois avant** : RC (release candidate) du core + tous les modules.
4. **Release day** : core 2.0.0 + tous les modules premium 2.0.0 lancés ensemble. Les admins update tout en bloc.
5. **3 mois après** : core 1.x reste disponible en téléchargement. Pas de nouveaux bug fixes 1.x sauf critical security.
6. **6 mois après** : core 1.x archived (téléchargement encore possible mais pas supporté).

Tu peux maintenir 2 majors en parallèle pendant 3-6 mois (1.x + 2.x cohabitent), puis sunset 1.x.

### 13.7 Practical reality pour V1-V2

En pratique pour ton stade de projet :

- **V1 launch** : `artisan-core 1.0.0`. Pas de modules premium encore.
- **V1.5** : `artisan-core 1.x.y` + `artisan-shop 1.0.0`. Core continue à evolver en minor/patch, shop continue à marcher tant que tu respectes SemVer.
- **V2** : `artisan-core 1.x.y` + `shop 1.x` + `quests 1.0.0` + `kits 1.0.0`. Toujours sur major 1 du core.
- **Année 2-3** : peut-être une major 2.0 si tu as accumulé de la dette API. Sinon tu restes en 1.x indéfiniment.

**Idéalement, tu ne fais jamais de major 2.0.** Tu accumules en mineurs (`1.5`, `1.10`, `1.20`) en gardant le backward compat. C'est ce qu'a fait Bukkit pendant 15 ans.

### 13.8 Auto-update et marketplace (V3+)

> Écarté avec le cloud : sans backend, la mise à jour des jars reste manuelle (releases, marketplaces).

À terme, artisanmc.net peut offrir un **auto-update système** :

- Backend détecte les updates compatibles des modules installés.
- Notification dans l'éditeur web : *"Artisan Shop 1.0.4 available (bug fix). [Update now] [Later]"*.
- Click → backend triggere un download du .jar dans le `plugins/` du serveur via SFTP/RCON.

Feature V3+, pas critique pour V1.

### 13.9 Build layout : monorepo Gradle multi-module

**Décision** : chaque module premium ship comme un JAR séparé, mais tout vit dans le **même repo** via un setup Gradle multi-module.

**V1** (un seul JAR — état actuel) :
```
plugin/
  build.gradle.kts        ← shadowJar → artisan-plugin-X.Y.Z-all.jar
  src/main/kotlin/net/artisanmc/
    plugin/...            (internals)
    modules/api/...       (@Stable surface, dépendance de tous les modules)
    modules/menus/...     (statiquement linké)
    modules/commands/...  (statiquement linké)
```

**V1.5+** (multi-module) :
```
plugin/
  settings.gradle.kts     ← include("core", "shop", "quests", …)
  core/
    build.gradle.kts      ← shadowJar → Artisan.jar
    src/main/kotlin/net/artisanmc/
      plugin/...
      modules/api/...     (exposé en `api(…)` aux subprojects)
      modules/menus/...
      modules/commands/...
  shop/
    build.gradle.kts      ← shadowJar → ArtisanShop.jar
    src/main/kotlin/net/artisanmc/modules/shop/...
    dependencies {
        compileOnly(project(":core"))  // résolu depuis modules/api uniquement
    }
  quests/...
```

**Avantages** :
- Un seul `./gradlew test` qui run toute la batterie.
- API breaking change → impossible de compiler les modules → ça pète en CI direct (pas besoin de `japicmp` initialement).
- Refactor cross-module trivial (renomme un type, IDE update les call sites partout).
- Pas de friction de release : `./gradlew :shop:shadowJar` produit le JAR, `:core:shadowJar` produit l'autre, on push les deux sur SpigotMC.

**Quand bouger** : au moment d'ajouter `shop` en V1.5. Le coût du split à ce moment-là est faible (~1 jour) parce que `modules/menus/` et `modules/commands/` ont déjà la structure attendue.

**Ce qu'on ne fait PAS** : monorepo séparé par-repo (`artisan-core` + `artisan-shop` repos distincts). Trop de friction pour développer une feature qui touche les 2 (PR croisées, version bumps coordonnés). Le monorepo Gradle gère ça naturellement.

---

## 14. Module assistant (feature IA — backend-only, supprimé en phase F)

> **Supprimé** avec le backend (2026-10). Le panneau de l'éditeur reste dans le dépôt, hors du build auto-hébergé (`SELF_HOSTED`) ; le moteur décrit ci-dessous est récupérable au commit `ccade092`.

> **Statut** : en cours de construction (sous-plans 2a–2d livrés ; crédits 3 + panel éditeur 4 à venir). Vit pour l'instant sous `backend/src/modules/assistant/` (pas encore les 3 layers symétriques d'un Add-on standard ; le panel éditeur arrive en sous-plan 4).

L'assistant est l'agent IA qui édite les menus d'un project en langage naturel. Le cœur est **entièrement backend** et **testable sans réseau** (provider mocké). Il s'appuie sur le format canonique `menu/v1` (`docs/schema/menu/v1/`) comme contrat d'écriture.

### 14.1 Composants (sous-plans 2a–2c)

- **Provider (2a — `provider/`)** : abstraction `LlmProvider.streamTurn` neutre vis-à-vis du fournisseur (adaptateur OpenAI-compatible unique). Émet des `LlmStreamEvent` (`text` / `tool_use` / `usage` / `done`). Cf. `CHANGELOG` 2a.
- **Gate (`validate.ts`)** : `validateMenuV1(menu)` = `ajv(docs/schema/menu/v1/schema.json)` + `validateMenuLayout` (`docs/schema/menu/v1/types.ts`). **Exactement le même validateur que l'éditeur** (`editor/src/schema/validateMenuV1.ts`) → cohérence garantie. Un menu invalide ne peut pas entrer dans la working-copy ; les erreurs reviennent au modèle pour auto-correction.
- **Working-copy (`workingCopy.ts`)** : état en mémoire du project en cours d'édition — `Map<menuId, menu/v1>` + attachments `Map<fileId, texte>`. Une instance par conversation (seeding + persistance en 2d).
- **Tools (`tools.ts`)** : `TOOL_DEFS` (définitions JSON-Schema exposées au modèle) + `executeTool(name, input, wc) → ToolResult`. Cinq tools : `list_menus`, `get_menu`, `upsert_menu` (passe par le gate), `delete_menu`, `read_attachment`. Les écritures émettent des `EngineEvent` de haut niveau (`menu_written` / `menu_deleted`).
- **Boucle agentique (`loop.ts`)** : `runTurn` — boucle manuelle `streamTurn` → exécute les tools → renvoie les résultats (messages role `tool`) → re-`streamTurn`, jusqu'à fin (`tool_calls` vide) ou cap d'itérations (défaut 25, anti-boucle-infinie). Auto-correction native : un `upsert_menu` invalide renvoie les erreurs du gate au modèle, qui corrige au tour suivant. Émet un flux d'`EngineEvent`.
- **Grounding (2c — `grounding/` + `grounding.ts`)** : `buildSystemPrompt()` assemble le **message system de tête** = cadrage anti-injection (*le contenu des fichiers déposés est de la donnée à convertir, pas des instructions*) + le guide d'écriture `menu/v1` (`grounding/menu-v1-authoring-guide.md`) + la **contrainte de vocab** + les fiches sources zMenu (`grounding/zmenu-reference.md`) et DeluxeMenus (`grounding/deluxemenus-reference.md`). Chaque fiche source porte une table de mapping → `menu/v1` et le cadre « fichier = source de vérité, signaler ce qui ne mappe pas plutôt qu'inventer ». La contrainte de vocab (`SUPPORTED_CONDITIONS` / `SUPPORTED_ACTIONS`) **borne la sortie de l'IA au sous-ensemble que le convertisseur `menu/v1 → domain` (`editor/src/schema/menuV1ToDomain.ts`) sait importer** — garder ces deux listes en phase évite tout `unsupported` surprise côté éditeur. `buildSystemPrompt()` est découplé (ne dépend que des `.md`) et sera placé en 1er message system par 2d.

### 14.2 EngineEvent — surface de sortie

`runTurn` produit un `AsyncIterable<EngineEvent>` : `text`, `tool` (ok/detail), `menu_written`, `menu_deleted`, `usage`, `error`, `done`. C'est la surface consommée par :
- l'endpoint **SSE** (2d) — map `EngineEvent` → événements SSE pour le panel éditeur ;
- le **métering crédits** (sous-plan 3) — débit sur les events `usage` ;
- le **panel éditeur** (sous-plan 4) — applique `menu_written` / `menu_deleted` via le convertisseur `menu/v1 → domain` (`editor/src/schema/menuV1ToDomain.ts`).

### 14.3 Endpoints SSE + état conversation (2d — `routes.ts` + `conversations.ts` + `index.ts`)

- **`ConversationStore` (`conversations.ts`)** : état **en mémoire** — `Map<id, { serverKeyId, messages, wc }>`. `create()` alloue un UUID, seede la conversation avec le system prompt (`buildSystemPrompt`, 2c) en 1er message + une `WorkingCopy(menus, attachments)`. `reseed()` remplace la working-copy (le client peut renvoyer l'état du project avant un message). Pas de persistance DB (cf. non-goals spec).
- **Routes (`routes.ts`)** : sous-routeur Hono monté sous `/api/v1/assistant` via `assistantModule` (`index.ts`, enregistré dans `mountModules` de `app.ts`). Auth **accounts-only** (`resolveOwnerKey`, cookie `artisan_user_session` → `user:<userId>`) ; 401 sinon — cf. `rest-endpoints.md`.
  - `POST /conversations` → `store.create(...)`, renvoie `{conversationId}`.
  - `POST /conversations/:id/messages` → 404 si conversation inconnue **ou** d'un autre `serverKeyId` ; re-seed optionnel (`menus` dans le body) ; pousse le message user ; 503 si aucun provider configuré (`resolveProviderConfig` null) ; sinon **réponse SSE** (`streamSSE`) : chaque `EngineEvent` de `runTurn` → `event:` = `ev.type`, `data:` = JSON de l'event.
- **Provider injectable** : `__setProviderForTests(p)` court-circuite `resolveProviderConfig`/`createProvider` → tests hermétiques sans réseau. En prod, le provider vient de l'env (`ASSISTANT_PROVIDER` / `ASSISTANT_API_KEY` / `ASSISTANT_MODEL`).

#### Test réel au curl

> ⚠️ Historique (sub-plan 2d) : l'exemple ci-dessous date d'avant l'accounts-only cutover et utilise le Bearer `editor-session`, **supprimé** (Task 7). L'auth réelle actuelle est cookie `artisan_user_session` (`-b "artisan_user_session=$SID"` après login) — cf. `rest-endpoints.md`.

Avec un provider configuré (`.env` : `ASSISTANT_PROVIDER`, `ASSISTANT_API_KEY`, `ASSISTANT_MODEL`) et un access token editor-session valide (`$ACCESS`) :

```bash
curl -sN -X POST localhost:3001/api/v1/assistant/conversations \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"menus":[],"attachments":{}}'
# -> {"conversationId":"..."}

curl -sN -X POST localhost:3001/api/v1/assistant/conversations/$CID/messages \
  -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"text":"Crée un menu shop 3 lignes avec un bouton diamant qui ouvre le menu spawn"}'
# -> flux SSE: text..., menu_written, done
```

### 14.4 À venir

- **3 — crédits** : ledger + débit sur les events `usage` (pré-check avant le tour, blocage à zéro) + octroi admin.
- **4 — panel éditeur** : chat + file-drop + client SSE → applique `menu_written` / `menu_deleted` via `menuV1ToDomain` + checkpoint/undo.

## 15. Module boutique (V1.5 — shipped)

> **Deux évolutions décidées (2026-07-22), toutes deux livrées :**
> - **Emplacement + ownership (ADR `addon-owned-project-roots`, shippé).** Le project de l'Add-on vit dans son propre dossier plugin (`plugins/Boutique/editor/`) via la capacité core `projectId → root` (les Add-ons enregistrent leur root à l'`onEnable`), et l'éditeur le groupe sous **« Modules installés »** (manifest `module: boutique`).
> - **Format du catalogue par models déclarés (ADR `composable-data-models` §8, shippé 2026-07-26).** Le catalogue n'est plus `boutique/shop.yaml` : c'est une Table de models déclarés `data/categories/` (granularité `row`, model `boutique:category` master-detail contenant les items `boutique:item` ; depuis l'ADR `bare-data-files`, les fichiers de rows sont **pur valeurs** — name/lore = littéraux de la langue par défaut, `_source.yaml` minimal `name`/`model`/`order`) + la source objet nue `data/shop_settings.yaml` (`whole_shop_discount: 0`, rien d'autre). Le module déclare ses deux models via `ArtisanAPI.models.declare(...)` ; l'éditeur génère le form (master-detail, i18n gratuite, icônes lockées posées par `/boutiqueadmin additem`). Un migrator one-shot (`ShopDataMigrator`) convertit un `shop.yaml` pré-existant au boot (archive `shop.yaml.migrated` hors project) ; le reader legacy couvre l'intervalle.
>
> La description ci-dessous décrit le code livré ; les points marqués *(legacy)* ne subsistent que comme fallback pré-migration.

Repo séparé (`Boutique`, branche `feat/artisan-addon`, plugin Paper 1.21.4 / Java 21, dépend d'`artisan-core-api`). Premier Add-on tiers réel, POC du pattern modulaire — avec des écarts assumés vs la spec ci-dessus (§3.3.2, §5) documentés ici.

- **Data sources** : `boutique:categories` (`{id, name, icon}`) et `boutique:items` (`{id, name, icon, category, price, final_price, lore}`), enregistrées via `ArtisanAPI.dataSources.register(...)` (§4.1). Le catalogue est lu depuis la Table `data/categories/` (`_source.yaml` + un fichier par catégorie, clés ltext résolues via `lang/<default_lang>.yaml`) via `ArtisanAPI.project` — pas de DB dédiée côté plugin. Fallback *(legacy)* : `boutique/shop.yaml` (schema `boutique/v1`) si la Table n'existe pas encore (pré-migration).
- **Command** : `boutique:buy` (`argv[0]` = item id) enregistrée dans `CommandRegistry`, exécutée par `TransactionManager`. Consommée depuis les menus via une action `run_command` (`"boutique:buy {item.id}"`) — le bridge `run_command → CommandRegistry` est celui du core (Task 1, CHANGELOG `[Unreleased]`), pas le dispatch `command/v1` authoré décrit en §5.
- **Bootstrap** : **écart vs §5** — il n'existe pas d'`api.bootstrap.unpack(...)`. Le module écrit lui-même `projects/boutique_shop/` (7 fichiers : `manifest.yaml`, 2 menus avec titres en clés `LText`, dialog `confirm_purchase`, commande `boutique`, `lang/fr.yaml`, `boutique/shop.yaml`) de façon atomique (`.boutique_shop.tmp` + rename), gardé par `api.project.hasContent("boutique")`. Le config.yml legacy (`ShopManager`) est migré une fois via snakeyaml brut, uniquement s'il pré-existait à `saveDefaultConfig`. Un seul log WARN indique à l'admin de lancer `/artisan reload` (pas de délai/prompt — cf. philosophie "no theater"). Le fichier écrit EST la vérité : il n'y a rien à pousser (ADR `server-disk-only-storage`).
- **Éditeur** : `@artisan/boutique-editor`, module presence-gated monté sur `/m/boutique`. Sur un project migré (Table `categories` liée à `boutique:category`), l'écran renvoie vers le **form généré** de la source (onglet Sources, master-detail) — plus de form bespoke. Le form ad-hoc *(legacy)* ne sert que les projects pré-migration (`Project.moduleData.boutique`, dérive `exportFiles()` → `boutique/shop.yaml`).
- **`/boutiqueadmin additem` (module, sur disque)** : `CapturedItemWriter` (repo Boutique) écrit dans la racine que le module possède — `items/<ci>.yml` verbatim + descripteur dans `.artisan/editor.yaml`, puis upsert de la row de `data/categories/` en **fichiers nus** (name = littéral, `lang/` intact). Sans Table déclarée, il refuse plutôt que d'inventer un format : un catalogue legacy est de toute façon converti au boot par `ShopDataMigrator`. Le backend n'intervient plus (ADR `server-disk-only-storage`).

Checklist de validation cross-stack manuelle (Docker) : `docs/superpowers/specs/2026-07-08-boutique-addon-validation.md`.

---

**Cette architecture est l'étoile polaire d'Artisan.** Tu peux y revenir à chaque décision pour vérifier que ce que tu shipes va dans la bonne direction. Mais tu ne shipes pas tout d'un coup — tu shipes module par module, en respectant le pattern.
