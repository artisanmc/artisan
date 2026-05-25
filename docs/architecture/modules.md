# Interfaze — Architecture modules

Spec d'architecture pour le pattern "modules" qui permet à Interfaze d'évoluer de "menu editor" vers "plateforme de configuration web pour plugins Minecraft", incrémentalement, sans refactor big-bang.

Statut : **architecture cible** — V1 implémente le menu editor comme premier module en suivant ce pattern. V1.5+ ajoute d'autres modules (shop, quests, kits, etc.). V3+ ouvre un SDK pour modules tiers.

---

## 1. Vision et positioning

À long terme, Interfaze n'est pas "un éditeur de menus". C'est **la couche de configuration web unifiée pour les plugins Minecraft modernes**. Le menu editor V1 est juste le **premier module** d'une plateforme plus large qui couvrira progressivement :

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

Le résultat : un admin gère **tous ses plugins compatibles Interfaze** depuis une UI unifiée, sans toucher à du YAML. Plus de friction de configuration.

## 2. Architecture : modular monolith

**Une seule app web, un seul backend, un seul plugin Java**. Mais avec des frontières de modules claires dans le code. Pas de microfrontends, pas de Module Federation, pas de plugin SDK dynamic loading. Trop complexe pour zéro ROI tant que tu écris tous les modules toi-même.

Modular monolith donne :

- Single deployment, single CI, single team
- Iteration rapide
- UX cohérente (mêmes primitives, même design system)
- Architecture qui se prête à un futur SDK 3ᵉ party (V3+) sans refactor

**Quand pivoter vers vrai plugin SDK** : seulement quand tu as 3+ modules tiers développés par d'autres et de la demande validée pour un programme officiel. Probablement V3+ ou au-delà.

## 3. Module abstraction

Un **module Interfaze** vit dans 3 endroits : éditeur web (frontend), backend, plugin Paper. Ces 3 parties d'un module sont déployées ensemble (parties du monolith) mais logiquement séparées.

### 3.1 Frontend module

```
/editor/src/modules/{module_id}/
  index.ts          ← Module registration
  editor/           ← Composants UI pour configurer ce module
  preview/          ← Preview du résultat (optionnel)
  schemas/          ← JSON schemas locaux (mirror du backend)
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

### 3.2 Backend module

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

### 3.3 Plugin module (Paper)

```
/plugin/src/main/kotlin/gg/interfaze/modules/{module_id}/
  {ModuleId}Module.kt      ← Module class implementing InterfazeModule
  providers/               ← Loaders, parsers (config from disk/cloud)
  executors/               ← Runtime behavior (handle commands, etc.)
  registries/              ← Registrations dans le runtime
```

**Interface Kotlin** :

```kotlin
interface InterfazeModule {
    val id: String                          // "menus", "shop", "quests"
    val schemaVersion: String                // "menu/v1", "shop/v1"
    
    fun onEnable(api: InterfazeAPI)         // Register data sources, commands, listeners
    fun onDisable()                         // Cleanup
    fun onReload()                          // Hot-reload de la config
}
```

Le plugin core charge tous les modules au boot via `ServiceLoader` ou registry explicite :

```kotlin
class InterfazePlugin : JavaPlugin() {
    override fun onEnable() {
        val modules = listOf(
            MenusModule(),
            CommandsModule(),
            // ShopModule() en V1.5
        )
        modules.forEach { it.onEnable(api) }
    }
}
```

## 4. Composition : data sources + commands

Les modules **ne se connaissent pas directement**. Ils communiquent via deux primitives universelles : **data sources** et **commands**.

### 4.1 Data sources

Un data source expose des données typées d'un module à tous les autres. Format : `namespace:source_id`.

Exemples :
- `shop:items` → liste des items du shop
- `shop:categories` → liste des catégories
- `quests:available` → liste des quêtes dispos pour un joueur
- `kits:available` → liste des kits dispos
- `essentials:warps` → liste des warps (via le connecteur EssentialsX)

**Le module menus consomme** des data sources via le champ `data_source.ref` de ses Elements (cf. main-spec section 14). Le menus module ne sait pas ce qu'est un "shop item" — il sait juste itérer une liste avec des champs typés.

**Le module shop expose** son data source via `InterfazeAPI.dataSources.register(...)` :

```kotlin
class ShopModule : InterfazeModule {
    override fun onEnable(api: InterfazeAPI) {
        api.dataSources.register(DataSourceDeclaration(
            ref = "shop:items",
            schema = ShopItemSchema,        // shape des objets retournés
            fetcher = { player, params -> shopRepo.getItems(player, params) }
        ))
    }
}
```

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

### 4.3 Avantages du pattern

- **Découplage** : le module menus n'a aucune dépendance sur shop, quests, etc.
- **Extensibilité** : ajouter un module = ajouter ses data sources/commands au registry. Aucun module existant ne doit être modifié.
- **Testabilité** : chaque module peut être testé isolément en mockant le registry.
- **Compatibilité plugins tiers (V2+)** : un plugin tiers peut s'enregistrer dans le même registry et devenir une data source / command disponible à tous les modules.

## 5. Module bootstrap : content bundles

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

1. Le module détecte qu'il n'y a pas encore de config shop dans le workspace.
2. Il propose un dialog *"Welcome to Shop module. We'll create some sample content to get you started — you can customize or delete it anytime. [Create] [Skip and configure from scratch]"*.
3. Click **Create** → le bundle bootstrap est unpacké dans le workspace :
   - Les menus arrivent dans `/menus/` (éditables via le module menus)
   - Les commandes arrivent dans `/commands/` (éditables via le module commands)
   - Les dialogs arrivent dans `/dialogs/` (éditables via le module dialogs)
   - Les clés i18n sont mergées dans `translations.json` du workspace
   - Les templates et assets sont ajoutés à la library
   - Les items exemples sont créés dans la config shop
4. L'admin a immédiatement un shop fonctionnel qu'il peut éditer pièce par pièce.

### 5.5 Édition post-bootstrap

**Une fois unpackées, ces resources sont des entités standard du workspace.** Le menu `shop_main` est un menu comme un autre, éditable dans le module menus. La commande `/shop` est éditable dans le module commands. Les translations sont éditables dans la section i18n.

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

- `menu/v1` → `menu/v2` (future, breaking change)
- `shop/v1` → `shop/v2`
- `quests/v1` → `quests/v2`

Le **plugin Paper et le web editor migrent au load** d'un schema antérieur vers le current. Pattern :

```kotlin
class MenusModule : InterfazeModule {
    override val schemaVersion = "menu/v2"
    
    fun loadMenu(json: JsonObject): Menu {
        val version = json["schema"].asString
        return when (version) {
            "menu/v1" -> migrateV1ToV2(json)
            "menu/v2" -> parseV2(json)
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
- `InterfazeModule` interface (Kotlin) côté plugin
- `BackendModule` / `FrontendModule` interfaces côté web
- `DataSourceRegistry` + `CommandRegistry` opérationnels
- 5 connecteurs homemade (EssentialsX, ChestShop, JobsReborn, LuckPerms, Quests) — ce sont déjà des modules read-only en pratique

### V1.5 (M+2 à M+4)

Premier module business : **shop**.
- Schema `shop/v1` avec items, categories, prices, stock
- Backend Fastify routes + Drizzle tables
- Frontend form-based editor + table d'items
- Template menu `shop_main` shippé
- Data source `shop:items`, command `shop:buy`
- AI assistant feature dispo
- Ce module shop devient **le proof of concept** du pattern modulaire en plus du menu editor.

### V2 (M+4 à M+8)

Ajout des modules :
- `quests` — chaînes de quêtes, objectives, rewards
- `kits` — items, cooldowns, permissions
- `warps` — locations
- `profiles` — player profile menus

Each module = ~1-2 semaines de dev grâce au pattern bien établi.

### V3+ (M+9+)

Ouverture du **SDK pour modules tiers** :
- Documentation publique du pattern `InterfazeModule`
- NPM package `@interfaze/sdk` pour le frontend
- Maven artifact `gg.interfaze:sdk` pour le plugin
- Validation et publication via Interfaze (review process)
- Marketplace de modules tiers (commission 15-30 %)

Le SDK n'est ouvert que quand tu as :
1. Au moins 5 modules built par toi (validation du pattern)
2. Demande validée par des 3ᵉ party developers (Discord, Reddit, contacts directs)
3. Capacité opérationnelle pour reviewer + supporter les modules tiers

## 10. Implications V1 immédiates

Si tu valides cette architecture, voici les ajouts à intégrer dans les 2-3 semaines V1 :

### Plugin (Kotlin)

- Interface `InterfazeModule` (~30 lignes)
- Classes `DataSourceRegistry` et `CommandRegistry` (~100 lignes chacune)
- `InterfazePlugin` charge un registry de modules au `onEnable()`
- `MenusModule` créé comme premier module (encapsule ce qui existe déjà)
- `CommandsModule` créé comme second module
- 5 connecteurs (EssentialsX, ChestShop, etc.) deviennent des sous-modules de leur namespace, enregistrés dans `DataSourceRegistry`

**Effort : ~2-3 jours** de refactor opportuniste. Le code de rendu menus existe déjà — tu le **wrapes** dans la classe `MenusModule`.

### Backend (Fastify)

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
- **Hot-reload cross-module** : si le module shop est rechargé, les menus qui consomment `shop:items` doivent re-fetch. Pattern observer / event bus côté plugin Paper à implémenter (~1 jour V1).

---

**Cette architecture est l'étoile polaire d'Interfaze.** Tu peux y revenir à chaque décision pour vérifier que ce que tu shipes va dans la bonne direction. Mais tu ne shipes pas tout d'un coup — tu shipes module par module, en respectant le pattern.

## 13. Physical layout — V1 vs target

The target layout in section 3.3 places module-specific code under
`gg.interfaze.modules.{id}/`. V1 keeps the existing physical structure
(`gg.interfaze.plugin.engine`, `gg.interfaze.plugin.command`, etc.) and only adds
the module wrapper classes under `gg.interfaze.modules.{id}/`.

**Why defer the move:**
- The wrapper interface (`InterfazeModule`) is what other code depends on.
- Moving ~50 files just to change package names is a high-risk, zero-behavior change.
- Move opportunistically when adding the 3rd module (shop V1.5), which makes the
  pattern more visible and amortises the rename cost.

**When to do the physical move:** when introducing `shop` module in V1.5 — by then
the pattern is established and the rename is justified by symmetry.

