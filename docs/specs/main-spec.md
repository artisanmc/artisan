# Interfaze — Plugin Minecraft d'édition de GUIs

**Spec produit — document de référence pour le développement et les décisions produit**
Version : draft 1 (avril 2026)

---

## 1. Vision et positionnement

### 1.1 Vision produit

Permettre à n'importe quel admin de serveur Minecraft de créer des interfaces (menus, GUIs) custom de qualité professionnelle, sans compétences en pixel art, sans jongler entre plusieurs plugins, et sans rédiger de YAML.

L'admin compose ses interfaces visuellement à partir d'assets existants — images vanilla, packs achetés sur MCModels, ou images personnelles uploadées — dans un éditeur web drag & drop. Le plugin génère automatiquement le resource pack et la config nécessaires, et tout est exécutable en jeu immédiatement.

### 1.2 Positionnement marché

Le produit n'est pas un concurrent direct de NxMenu. NxMenu cible les designers pixel art capables de créer des assets, et reste un outil de **création artistique**. Notre produit cible les 95% restants : les admins qui veulent de beaux menus mais qui ne savent pas (et ne veulent pas apprendre à) dessiner. C'est un outil de **composition et de configuration**, pas de création graphique.

Face aux solutions existantes du marché :

- **vs zMenu / DeluxeMenus** : alternative moderne où la configuration se fait visuellement au lieu de YAML. Adoption massive visée comme nouveau standard de fait pour les menus de serveurs.
- **vs Nexo / ItemAdder** : ce ne sont pas des concurrents directs (Nexo et ItemAdder gèrent les items custom du jeu, pas les GUIs spécifiquement). Notre produit cohabite avec eux et peut s'intégrer à leur écosystème en v2.
- **vs NxMenu** : positionnement complémentaire, pas concurrentiel. NxMenu pour ceux qui dessinent, notre produit pour ceux qui composent.

### 1.3 Différenciation clé

L'admin compose des GUIs sans pixel art, le tout dans un éditeur web moderne avec édition live (la WS pousse les modifications en jeu instantanément). Le freemium permet l'adoption massive ; le payant capture la valeur sur les use cases avancés (custom assets). Démo soignée, vraie communauté, vraie roadmap publique.

---

## 2. Architecture générale

### 2.1 Pattern architectural

L'architecture repose sur un pattern **hosted-edit / local-runtime** :

- **Côté éditeur** : application web hébergée par nous (ex. `editor.interfaze.gg`). C'est là que les admins configurent leurs menus, gèrent leurs assets, organisent leurs équipes.
- **Côté plugin** : module Spigot/Paper installé sur le serveur Minecraft de l'admin. Il sert les menus aux joueurs, gère les inventaires natifs, exécute les actions au clic. Fonctionne offline-first : aucune dépendance internet en jeu. Si l'éditeur tombe, les serveurs des clients continuent à servir leurs menus normalement.

### 2.2 Flux de données

```
[Admin]
   │
   │ 1. Édite via web (drag & drop)
   ▼
[Éditeur web hosted] ◄────── 2. WS persistant ──────► [Plugin Minecraft]
   │                                                       │
   │ 3. Génère bundle (config + resource pack)             │
   │                                                       │ 4. Sert les menus
   ▼                                                       ▼
[CDN] ────── 5. Joueurs téléchargent le pack ───────► [Joueur en jeu]
```

### 2.3 Trois canaux de communication

- **WebSocket éditeur ↔ plugin** : connexion sortante du plugin vers l'éditeur (pas de port à ouvrir, fonctionne derrière NAT/firewall). Sert le draft (édition live), la commande "publish", le sync au boot du plugin.
- **HTTPS éditeur → CDN** : upload des bundles signés générés (resource pack + config).
- **HTTPS joueur → CDN** : téléchargement du resource pack quand le joueur rejoint le serveur.

### 2.4 Modes d'opération côté plugin

Le plugin maintient deux "flavors" d'un même menu pour permettre l'édition non-disruptive :

- **Live (production)** : version actuelle persistée sur disque, servie à tous les joueurs. Indépendante de la WS — si le tunnel tombe, la live continue de fonctionner.
- **Draft (édition live)** : ce que l'admin est en train de bidouiller dans l'éditeur. Visible uniquement par lui via `/menu preview <id>`. Re-render quasi-instantané à chaque modification via la WS.

Un troisième flavor **Staging** (preview gelée accessible à des testeurs invités via `menu.preview.<id>`) est prévu en V1.5 quand les workflows en équipe deviennent un use case réel.

---

## 3. Modèle business

### 3.1 Philosophie freemium

**Le free tier est généreux et complet.** L'admin solo / hobbyist a accès à toutes les capacités créatives de l'éditeur : menus illimités, custom assets illimités (sous un cap silencieux de storage), toutes les actions, apparences conditionnelles, templates, asset library, génération de resource pack, hosting CDN, intégrations plugins tiers.

**Le paywall est sur le scale, pas sur les features.** Les axes payants sont :

- **Seats (membres d'équipe)** : free = 1 seat. Tu invites un co-admin → tu upgrades. Aligné sur le moment où le serveur passe d'amateur à sérieux.
- **Servers connectés** : free = 1 serveur. Multi-server signale un network ou un setup pro.
- **Features à coût marginal réel** : import MCModels (gros payload + parsing CPU), assistant IA (Claude API), marketplace selling (curation, payment infra) — toutes payantes.

Cette structure préserve les solo creators comme ambassadeurs (ils stylisent, partagent, font des vidéos YouTube avec des menus complets, recrutent des nouveaux users), et capture le payant sur les signaux de "vrai usage" : équipe, multi-server, features avancées.

### 3.2 Tiers d'abonnement

| | Free | Solo | Network | Unlimited |
|---|---|---|---|---|
| Toutes les features de l'éditeur | ✓ | ✓ | ✓ | ✓ |
| Menus | illimité | illimité | illimité | illimité |
| Commandes custom | illimité | illimité | illimité | illimité |
| Langues + clés i18n | illimité | illimité | illimité | illimité |
| Custom assets / textures | illimité | illimité | illimité | illimité |
| Storage cap (safety silencieuse) | 500 MB | 2 GB | 20 GB | illimité |
| **Seats (membres équipe)** | **1** | **1** | **5** | **illimité** |
| **Serveurs connectés** | **1** | **3** | **10** | **illimité** |
| Import MCModels (.zip) | ✗ | ✓ | ✓ | ✓ |
| Assistant IA (V1.5) | 5 req/mois | 50/mois | 500/mois | illimité |
| Vendre sur marketplace (V3) | ✗ | ✗ | ✓ | ✓ |
| CDN priority | standard | standard | premium | premium |
| Prix indicatif (TBD post-beta) | gratuit | ~5 € / mois | ~15 € / mois | ~30-40 € / mois |

**Personas servis :**

- **Free** : solo / hobby admin avec un serveur, fait son contenu, aucune équipe. Reste gratuit indéfiniment, devient ambassadeur Discord/Reddit/YouTube.
- **Solo** : admin solo qui veut MCModels (a investi dans des packs), ou qui gère 2-3 serveurs perso. Pas d'équipe.
- **Network** : owner d'un public server avec 3-5 staff. Co-admins, builders, mods. Multi-serveur.
- **Unlimited** : grand network, dev d'un produit basé sur Interfaze, créateur qui vend des packs sur la marketplace.

**Conversion triggers concrets et lisibles :**

- Free user invite un co-admin → modal *"Tu as atteint la limite de 1 seat. Network (~15 €) débloque 5 seats."*
- Free user achète un pack MCModels et tente l'import → *"L'import MCModels nécessite Solo (~5 €) ou plus."*
- Free user ajoute un 2e serveur → *"Tu as 1 serveur Interfaze actif. Solo (~5 €) débloque jusqu'à 3 serveurs."*

Chaque trigger est attaché à un bénéfice tangible. Aucun ne dit *"tu ne peux pas créer de contenu"* — la création reste libre.

Calibration finale du pricing à faire post-beta après mesure des usages réels et survey des early users.

### 3.3 Anti-cracking

Approche minimaliste, alignée avec la philosophie "on ne pénalise pas, on facture la productivité" :

- **Validation au sync** : le plugin pull un bundle, l'éditeur valide la clé serveur, refuse si déjà utilisée par un autre serveur (fingerprint IP+port+motd).
- **Signature liée au serveur** : chaque bundle généré contient une signature qui n'est valide que pour la clé serveur cible. Empêche le partage entre admins ("tiens prends mon bundle").
- **Pas de re-validation périodique** : un bundle reste valide indéfiniment une fois sur le serveur. L'admin qui annule son abo conserve ses menus existants en lecture seule (basculement vers free tier : 1 seat, 1 serveur). Les seats supplémentaires perdent l'accès à l'éditeur ; le plugin continue de servir les versions live des menus.

Le modèle seat-based renforce naturellement la résistance au crack : un cracker ne peut pas "se donner" des seats supplémentaires sans contrôler l'auth des comptes Interfaze. Pour les features serveur (MCModels parsing, AI quota), le coût marginal est côté backend Interfaze, donc les bypasser nécessite de répliquer l'infrastructure — au-delà de l'effort d'un cracker typique.

Ce modèle assume une perte de revenus (admins qui sync une fois et arrêtent), compensée par une friction nulle pour les clients légitimes et une réputation produit favorable.

---

## 4. Système d'édition (mode unifié à divulgation progressive + JSON)

### 4.1 Principe : un seul mode, complexité progressive

Pas de toggle "Visual / Advanced". Un éditeur unifié qui présente les actions simples au premier plan et expose les capacités avancées via des boutons "+ Ajouter X" et des sections expandables. Inspiration : Notion (slash commands), Linear (filtres et options inline), Figma (panels nested). Interface clean par défaut, tout accessible en un clic.

Bénéfices :

- **Discoverability** : les boutons "+" servent eux-mêmes de docs implicite ("ah, je peux ajouter un cooldown ici").
- **Pas de friction** : pas de "switcher pour faire X". Workflow fluide pour novices et power users.
- **Architecture simple** : pas de state de mode à gérer, un seul DOM tree avec sections collapsables.

### 4.2 Hiérarchie de divulgation

Pour chaque slot, le panel de propriétés expose :

- **Toujours visible** : apparence (asset / material, title, lore, count) et click action principale (left click + sa séquence d'actions atomiques).
- **Visible mais discret (boutons "+ Ajouter X")** : ajouter une condition / un cooldown / un fallback / un autre type de clic / un état conditionnel / des tags. Chaque "+" expose inline le formulaire approprié.
- **Auto-affiché si pertinent** : section composant tiers (si le slot référence un `component_ref`), section template (si instance), badges d'erreur (asset manquant, composant indisponible, etc.).
- **Universellement accessible** : variables et placeholders disponibles via autocomplete dans n'importe quel champ texte (titre, lore, message d'action) — pas besoin d'activer un mode.

Les sections expandées sont mémorisées par compte/menu : l'admin qui travaille toujours avec apparences conditionnelles ouverts les retrouve à l'ouverture de l'éditeur.

### 4.3 Extensibilité — JSON Export/Import + IA

Pas d'éditeur de code embarqué dans l'UI. Les power users qui veulent manipuler le format directement passent par trois capacités complémentaires :

- **Export JSON** : télécharge le menu courant en `.json`. Utile pour partage, versionning Git, manipulation externe.
- **Import JSON** : upload d'un `.json` validé strictement contre le schéma versionné. Remplace le draft courant.
- **View raw JSON** : modal read-only avec copy-to-clipboard et deep links vers IA externes (V1.5+).

**Philosophie AI-native** : en 2026, l'interface "code" naturelle pour un power user n'est plus un éditeur YAML, c'est une IA. L'admin qui veut une modif complexe décrit son intention à Claude/GPT, copie-colle le JSON résultat. Le schéma JSON est traité comme un asset produit central :

- Versionné (`menu/v1`, `menu/v2`...) avec migrations applicables au load.
- Documenté en TypeScript types + JSON Schema, publié sur `docs.interfaze.gg/schema`.
- Exemples annotés pour les patterns courants (shop simple, paginé avec composant tiers, apparences conditionnelles, etc.).
- Stable et explicite (noms de champs verbeux : `requirements` plutôt que `req`).

Cette approche simplifie massivement l'architecture (pas de sync bidirectionnel à maintenir) et ouvre une roadmap d'intégration IA progressive : assistant IA intégré en V1.5, serveur MCP en V2 pour Claude Desktop / Cursor / etc.

### 4.4 Canvas multi-menu (V1)

En complément de l'éditeur de menu détaillé (zoom in sur un menu), l'éditeur expose un mode **canvas multi-menu** style Figma : un espace infini où chaque menu apparaît comme une carte preview, et les actions `open_menu` se traduisent en flèches automatiques entre les cartes. Permet de visualiser et manipuler la structure de navigation complète d'un serveur en un coup d'œil.

Use cases :

- **Vision d'ensemble** : voir tous les menus d'un serveur, leurs liens, les orphelins (menus non-référencés).
- **Manipulation directe des liens** : tirer une flèche depuis un bouton vers un menu cible au lieu de taper son `menu_id`.
- **Spatial memory** : organiser les menus visuellement (shops à gauche, navigation au centre, admin tools en bas).
- **Synergie IA (V1.5+ pour l'assistant intégré)** : *"ajoute un menu profile et link-le depuis main_menu"* → l'IA crée la donnée, l'éditeur auto-layout la nouvelle carte. L'IA ne fait jamais de placement spatial elle-même — c'est le rôle du layout engine. Le canvas est dispo en V1, l'assistant IA s'y branche en V1.5.
- **Foundation pour le MCP server (V2)** : la vue canvas et le serveur MCP exposent la même donnée graphe sous deux formes (visuelle vs structurée), aucune duplication.

**Implémentation prévue** : React Flow pour le canvas (standard 2026 pour les éditeurs node-based). Chaque menu = node custom rendu comme aperçu d'inventaire. Chaque `open_menu` action détectée dans n'importe quel Element = edge auto-généré (jamais stocké, toujours dérivé).

**Storage** : la position (x, y) de chaque menu sur le canvas est stockée côté workspace backend (`workspace_layout` table), pas dans le menu JSON. C'est de l'état UX, pas du runtime. Les menus restent portables sans cette info — au pire, l'auto-layout repositionne tout à l'import.

### 4.5 Copy/paste — règles d'identité

Pour les opérations copier-coller dans l'éditeur :

**Element copié dans le même menu** : nouvel `id` auto-généré (suffixe `_2`, `_3`, etc.). Les `cooldown.id` à l'intérieur sont aussi renommés pour ne pas partager les cooldowns avec l'original.

**Element copié dans un autre menu** : on garde l'`id` original sauf si collision avec un Element existant dans la cible. Si collision → auto-rename comme ci-dessus. Les références `pagination_*.element_id` à l'intérieur du contenu copié pointant vers d'autres Elements du *même menu source* deviennent dangling après le paste — l'éditeur warn et propose un fix.

**Element copié sur le canvas vide** : rejeté. Un Element a besoin d'un menu cible. L'orphelin n'existe que dans le clipboard de l'éditeur (state mémoire transitoire), jamais dans la donnée persistée.

**Menu entier copié dans le workspace** : nouveau `menu.id` auto-généré (`shop_main` → `shop_main_2`). Tous les ids d'Elements à l'intérieur sont conservés (scope menu). Les `open_menu` actions *à l'intérieur* du menu copié restent inchangées (l'admin voulait sûrement la même structure de navigation interne). Les `open_menu` actions *des autres menus* qui pointaient vers le menu source ne sont pas auto-redirigées vers la copie.

**Commande copiée dans le workspace** : nouveau `id` auto-généré, et le `name` est suffixé `_2`/`_3` pour éviter le conflit (l'admin renomme avant publish).

### 4.6 Éditeur de commandes

Les commandes (cf. section 14) ont leur propre éditeur dans le dashboard, accessible via l'onglet "Commandes" du pack courant. Pas de canvas slot, pas d'inventaire — juste un formulaire structuré : métadonnées (name, aliases, permission, description), liste d'arguments avec drag-handle pour réordonner, requirements + actions + fallback éditables avec les mêmes widgets que les click handlers de menu (réutilisation du composant React `<ActionsEditor>`).

Le canvas multi-menu (section 4.4) affiche les commandes comme des nœuds distincts (forme et couleur dédiées), avec une flèche vers le menu qu'elles ouvrent (s'il y en a un).

---

## 5. Catalogue d'actions

### 5.1 Actions atomiques (MVP)

15 actions au launch, couvrant ~95% des use cases shop / menu / admin :

| Action | Paramètres |
|---|---|
| `run_command` | command (string), as (`player` / `console`) |
| `open_menu` | menu_id, optional close_current (bool), optional clear_context (bool, cf. section 14.4) |
| `close_menu` | — |
| `give_item` | material, count, optional nbt, optional name, optional lore |
| `take_item` | material, count, optional nbt match |
| `give_money` | amount, optional currency (Vault) |
| `take_money` | amount, optional currency (Vault) |
| `give_xp` | amount |
| `give_level` | amount |
| `send_message` | text (avec placeholders) |
| `broadcast` | text (server-wide) |
| `play_sound` | sound, volume (0-1), pitch (0-2) |
| `teleport` | location (world + x/y/z + yaw/pitch) ou warp_name |
| `pagination_next` | optional element_id (auto-bind si une seule liste paginée dans le menu) |
| `pagination_prev` | optional element_id (auto-bind si une seule liste paginée) |

### 5.2 Conditions (couche 2)

| Condition | Description |
|---|---|
| `has_permission` | perm string |
| `has_money` | amount, optional currency |
| `has_item` | material, count, optional nbt match |
| `has_xp` | amount |
| `has_level` | level minimum |
| `placeholder_equals` | placeholder, value |
| `placeholder_match` | placeholder, regex |
| `cooldown_passed` | cooldown_id |
| `world_is` | world name |
| `time_is` | range (`day`, `night`, ou ticks custom) |
| `random_chance` | probability (0-1) |
| `player_in_region` | region (si WorldGuard détecté) |
| `pagination_at_first` | optional element_id — utile pour griser un bouton "prev" via une apparence conditionnelle |
| `pagination_at_last` | optional element_id — utile pour griser un bouton "next" via une apparence conditionnelle |
| `not` | wrappe une condition |
| `and` / `or` | composition de conditions |

### 5.3 Requirements et fallback

Une chaîne d'actions au clic peut spécifier :

- `requirements` : liste de conditions (ANDées par défaut) à vérifier avant exécution.
- `actions` : à exécuter si toutes les requirements passent.
- `fallback` : à exécuter si une requirement échoue (par défaut un message "vous ne pouvez pas faire ça").
- `cooldown` : id + durée + scope + message custom si en cooldown.

### 5.4 Variables (v2)

Reportées en v2. En attendant, on s'appuie sur PlaceholderAPI et ses extensions pour les use cases compteur / progress dynamique. La structure de la spec ne préempte pas leur ajout : un `set_variable` action et des conditions `variable_equals` / `variable_match` viendront s'ajouter naturellement.

---

## 6. Apparences conditionnelles + Layers

### 6.1 Modèle Apparences

Un Element a une liste d'`appearances`, chacune **complète et auto-suffisante** (pas d'héritage entre elles). Le moteur évalue les apparences dans l'ordre : la première dont `if` matche (ou dont `if` est absent = match implicite) gagne et est rendue. Si **aucune ne matche** → l'Element n'est pas rendu, fall-through au layer en dessous.

Pas de notion de "default vs state" séparée : c'est une liste uniforme de variantes. Une apparence sans `if` sert de fallback (à placer en dernier dans la liste).

### 6.2 Layers

Le menu est organisé en **layers** ordonnés bottom → top. Au render, le moteur parcourt les layers du haut vers le bas pour chaque position : prend le premier Element qui rend quelque chose. Permet le pattern *"bouton conditionnel + déco en dessous"* : si le bouton n'a pas d'apparence qui matche, le layer décoration prend le relais.

L'éditeur affiche un panel layer (style Photoshop / Figma) avec toggle œil et cadenas par layer (UI-only, n'affecte pas le rendu en jeu). Un menu trivial a un seul layer "default", auto-créé, et le panel layer reste replié — l'admin novice ne voit pas la complexité.

### 6.3 Refresh

Les apparences sont ré-évaluées :

- À l'ouverture du menu.
- Après chaque clic dans le menu (pour refléter immédiatement l'état post-action).

Pas de refresh périodique au MVP (coût CPU). Refresh continu pour progress bars dynamiques sera une feature v2.

### 6.4 Click dans une apparence

- Apparence avec `click` défini → cliquable selon le ClickMap.
- Apparence avec `click: null` → explicitement non-cliquable (lisibilité).
- Apparence sans `click` (undefined) → non-cliquable.

### 6.5 Exemple

```json
{
  "id": "btn_rank_vip",
  "positions": "15",
  "appearances": [
    {
      "if": [{ "type": "has_permission", "perm": "rank.vip" }],
      "asset": "rank_vip_owned.png",
      "title": "§6Rank VIP",
      "lore": ["§aDéjà possédé"],
      "click": null
    },
    {
      "if": [{ "type": "not", "of": { "type": "has_money", "amount": 500 } }],
      "asset": "rank_vip_disabled.png",
      "title": "§6Rank VIP",
      "lore": ["§cIl te manque de l'argent"],
      "click": null
    },
    {
      "asset": "rank_vip_button.png",
      "title": "§6Rank VIP",
      "lore": ["§7Prix: §a500$", "", "§eClique pour acheter"],
      "click": {
        "left": {
          "requirements": [{ "type": "has_money", "amount": 500 }],
          "actions": [
            { "type": "take_money", "amount": 500 },
            { "type": "run_command", "command": "lp user %player_name% parent set vip", "as": "console" },
            { "type": "send_message", "text": "§aRank VIP débloqué !" }
          ],
          "fallback": [{ "type": "send_message", "text": "§cPas assez d'argent" }]
        }
      }
    }
  ]
}
```

Trois apparences évaluées dans l'ordre. La dernière (sans `if`) sert de fallback. JSON un peu plus verbeux qu'un partial override mais chaque apparence est complète et lisible isolément.

---

## 7. Templates user-defined (Symbols)

### 7.1 Concept

Inspiré de "symbols" dans Figma ou "blocks" dans Wordpress. L'admin sauvegarde un slot configuré sous un nom (ex. `bouton_acheter`). Il peut le réutiliser dans n'importe quel menu, et toute modification du template propage à toutes ses instances (avec confirmation).

### 7.2 Variables typées dans les templates

Pour permettre la vraie réutilisation, les templates supportent des variables typées :

```json
{
  "schema": "template/v1",
  "template_id": "bouton_acheter",
  "variables": [
    { "name": "prix", "type": "number" },
    { "name": "item_material", "type": "material" },
    { "name": "item_name", "type": "string" }
  ],
  "appearances": [
    {
      "asset": "buy_button.png",
      "title": "Acheter {{item_name}}",
      "lore": ["§7Prix: §a{{prix}}$"],
      "click": {
        "left": {
          "requirements": [{ "type": "has_money", "amount": "{{prix}}" }],
          "actions": [
            { "type": "take_money", "amount": "{{prix}}" },
            { "type": "give_item", "material": "{{item_material}}", "count": 1 }
          ]
        }
      }
    }
  ]
}
```

### 7.3 Override local

Quand on instancie un template dans un menu, on fournit les valeurs des variables. On peut aussi, optionnellement, **overrider localement** des champs (ex. lore ajouté pour cette instance uniquement). L'UI distingue clairement :

- "Édition du template" → propage à toutes les instances (avec une confirmation).
- "Override local" → ne change que cette instance.

### 7.4 Détachement

Un admin peut "détacher" une instance d'un template (équivalent du "Detach symbol" Figma). L'instance devient un slot standalone éditable librement, plus aucune propagation depuis le template.

---

## 8. Format intermédiaire (JSON)

### 8.1 Principes

- **Versionné** dès le départ (`"schema": "menu/v1"`) avec migrations applicables au load.
- **Source de vérité unique** : tout l'état d'un menu est dans son JSON. Pas de données dérivées séparées.
- **Lisible humainement** : un power user doit pouvoir comprendre et éditer en mode Code sans documentation.
- **Layers + Element id-indexés** : un menu contient des Layers (conteneurs ordonnés bottom→top), chacun contient des Elements. Chaque Element a un `id` stable et occupe une ou plusieurs positions Minecraft via `positions`. Au render, le moteur parcourt les layers du haut vers le bas et prend le premier Element visible à chaque position.
- **Apparences uniformes** : chaque Element a une liste d'`appearances`, chacune complète et auto-suffisante. Première dont `if` matche gagne. Si aucune ne matche → fall-through au layer suivant.
- Le terme « slot » dans les sections 4–7 réfère informellement à un Element ; le nom formel dans le schéma est **Element**.

> Le schéma complet (JSON Schema Draft 2020-12 + types TypeScript + 5 exemples annotés + README de design) vit dans [`docs/schema/menu/v1/`](../schema/menu/v1/) et est la source de vérité validable. Cette section reste un résumé pour lecture.

### 8.2 Schéma top-level d'un menu

```json
{
  "schema": "menu/v1",
  "id": "shop_main",
  "title": "Shop principal",
  "size": 27,
  "permission": "menu.shop.open",
  "background": { "asset": "shop_bg.png" },
  "open_requirements": [...],
  "open_actions": [...],
  "close_actions": [...],
  "layers": [
    {
      "id": "decoration",
      "name": "Décoration",
      "elements": [
        { "id": "deco_top_row", "positions": "0-8", "appearances": [...] }
      ]
    },
    {
      "id": "items",
      "name": "Items",
      "elements": [
        { "id": "btn_diamond_sword", "positions": "11", "appearances": [...] },
        { "id": "btn_rank_vip",      "positions": "15", "appearances": [...] },
        { "id": "btn_close",         "positions": "22", "appearances": [...] }
      ]
    }
  ],
  "metadata": { "uses_plugins": ["questx"] }
}
```

### 8.3 Schéma d'un Element

```json
{
  "id": "btn_buy",                // requis, unique dans le menu (cross-layer)
  "positions": "15",               // requis, "15" ou range "10-43"
  "appearances": [                 // requis, au moins une, première match gagne
    {
      "if": [...],                 // optionnel ; si absent = matche toujours (fallback, à placer en dernier)
      "asset": "image.png",        // optional
      "material": "DIAMOND",       // optional
      "count": 1,
      "title": "Titre",
      "lore": ["ligne 1", "ligne 2"],
      "enchanted": false,
      "custom_model_data": "...",  // CMD string 1.21.4+
      "component_ref": "questx:quest_button",  // optional, composant tiers
      "click": {
        "left":  { "requirements": [...], "actions": [...], "fallback": [...], "cooldown": {...} },
        "right": { ... },
        "shift_left": { ... },
        "shift_right": { ... },
        "middle": { ... }
      }
    }
  ],
  "template_ref": null,           // ou { "id": "...", "vars": {...}, "overrides": {...} }
  "tags": ["shop", "premium"]     // pour search/filter dans l'éditeur
}
```

### 8.4 Sémantique de rendu

Pour chaque position 0 à `size-1`, le moteur :

1. Parcourt les layers de **haut en bas** (`menu.layers` lu en ordre inverse — dernier de la liste = top)
2. Pour chaque layer, identifie l'Element qui revendique cette position (last-placed-wins en cas d'overlap intra-layer)
3. Évalue les `appearances` dans l'ordre. Première dont `if` matche → render à cette position, slot terminé
4. Aucune appearance ne matche → fall-through au layer suivant
5. Aucun layer ne fournit un Element rendu → render `menu.background` si défini, sinon position vide

### 8.5 Migrations

Un fichier `migrations.json` côté plugin liste les migrations applicables. Au load d'un menu :

```
read schema_version
while schema_version < latest:
  apply migration[schema_version → schema_version + 1]
  schema_version += 1
```

Les migrations sont versionnées et testées. Un menu en v1 reste lisible par un plugin en v3 (les migrations sont appliquées à la volée).

---

## 9. Resource pack generation

### 9.1 Cible technique

Minecraft **1.21.4+** uniquement. Cette décision permet :

- L'usage de `custom_model_data` en string (`"interfaze:button_buy"`), évitant tout conflit de namespace avec Nexo, ItemAdder, ou tout autre pack.
- Le pack stacking (depuis 1.20.3+) qui permet à plusieurs resource packs de coexister. Notre pack généré cohabite sans friction avec ceux des autres plugins.

### 9.2 Mécanismes de rendu

Deux techniques combinées :

- **Items custom (CMD strings)** : pour chaque slot avec un asset custom, on génère un modèle d'item lié à un CMD string unique. Le slot affiche un item vanilla (paper, stick) avec ce CMD. Le client résout le modèle via le pack.
- **Polices custom** : pour les éléments décoratifs et backgrounds (qu'on superpose dans le titre du menu), on définit des polices custom nommées (`interfaze:menu_overlay`). Chaque caractère est mappé à une image. Cela permet de superposer plusieurs éléments visuels dans une seule zone de titre.

### 9.3 Structure du pack généré

```
pack/
  pack.mcmeta
  assets/
    interfaze/
      textures/
        items/<asset_name>.png
        font/<font_glyphs>.png
      models/
        item/<item_id>.json     # modèle référencé par CMD string
      font/
        menu_overlay.json       # police custom
        decorations.json
```

### 9.4 Pipeline de génération

```
1. Asset library de l'admin (uploads + imports MCModels)
   ↓
2. Normalisation (resize au plus proche multiple de 16, popup d'info si non-conforme)
   ↓
3. Allocation des CMD strings (déterministe : interfaze:menu_<menu_id>_<slot_id>)
   ↓
4. Génération des modèles JSON
   ↓
5. Génération des polices pour les overlays
   ↓
6. Packaging .zip + signature serveur
   ↓
7. Upload sur le CDN (URL retournée au plugin)
```

### 9.5 Hosting

- **CDN éditeur (par défaut)** : le bundle .zip est uploadé sur notre CDN, le plugin envoie l'URL aux joueurs (`server.send_resource_pack(url)`). Rapide, fiable, pas d'ouverture de port côté serveur de l'admin.
- **Plugin self-host (fallback)** : option dans `config.yml`. Le plugin sert le pack via un mini serveur HTTP local. Pour les admins qui veulent l'autonomie complète ou qui sont sur des networks d'entreprise. Documenter les considérations de port forwarding / reverse proxy.

### 9.6 Gestion des assets

- **Normalisation auto** : à l'upload, l'image est redimensionnée au plus proche multiple de 16 (16, 32, 64, 128px). Une popup informe l'admin de la transformation, avec preview before/after. Toggle "ne plus afficher" pour les power users.
- **Validation** : on accepte uniquement PNG. JPG refusé (compression destructive incompatible avec les overlays). Limite par fichier : 256 KB normalisée, 2 MB pré-normalisation.
- **Limites quotas** par tier (cf. section 3.2).

---

## 10. Format des textes affichés (MiniMessage + i18n)

Tous les champs texte des menus et commandes (titres, lores, messages, descriptions de commandes, etc.) suivent une convention de contenu unifiée qui combine **MiniMessage** pour le formatage et **i18n** pour la traduction.

### 10.1 Format MiniMessage (Adventure / Paper)

Les champs texte sont stockés et rendus en **MiniMessage**, le format texte standard de Adventure et Paper depuis 2022. Format de tags XML-like, beaucoup plus puissant et lisible que les codes legacy `§a` :

```
<gold><bold>Boutique</bold></gold>
<gradient:#a8e063:#56ab2f>Bienvenue, %player_name% !</gradient>
<click:run_command:'/heal'><yellow>Cliquer pour se soigner</yellow></click>
```

Tags supportés au runtime (par Adventure) : couleurs nommées (`<red>`), couleurs hex (`<color:#ff00aa>`), modifiers (`<bold>`, `<italic>`, `<underlined>`, `<strikethrough>`, `<obfuscated>`), `<reset>`, `<rainbow>`, `<gradient>`, `<click>`, `<hover>`, `<insertion>`, `<keybind>`, `<lang>`, `<font>`, `<newline>`. Documentation : https://docs.advntr.dev/minimessage/format.html

**Codes legacy `§a` / `&a`** : acceptés en input (l'admin colle un message d'un autre plugin) mais **convertis en MiniMessage au save** (canonicalisation côté backend, idempotente). Opt-out possible dans les settings workspace pour garder le legacy.

### 10.2 Éditeur MiniMessage avec preview live

L'éditeur fournit un composant `<MiniMessageEditor>` réutilisé pour tous les champs texte :

- **Toolbar inline** : B/I/U/S, color picker (palette MC + custom HEX), bouton "gradient", insertion `{i18n:key}`, insertion placeholder PAPI.
- **Champ d'édition** : textarea avec syntax highlighting léger des tags (couleurs des `<...>` style monospace gris).
- **Preview live** debounced ~50 ms : rendu HTML + font Minecraft-like (Open Source, ~30 KB), background dark transparent style inventory tooltip. C'est ce que verra le joueur.
- **Autocomplete tag** au moment où tu tapes `<` : liste filtrée des tags MiniMessage avec doc tooltip.

Variantes single-line (title) et multi-line (lore = liste de lignes, chaque ligne est un MiniMessageEditor).

**Implémentation** : composant React natif, parser MiniMessage TS-native (~500 lignes), font Minecraftia ou similaire OSS bundlée. Adventure-webui (PaperMC, MIT) sert de **référence visuelle** mais on n'iframe pas — full intégration avec notre state pour l'autocomplete des i18n keys et placeholders.

### 10.3 Internationalisation (i18n)

**Une clé i18n** = un texte traduisible scoped au workspace de l'admin. Référencée dans n'importe quel champ texte via la syntaxe inline `{i18n:menu.shop.title}` mélangeable librement avec du MiniMessage et des placeholders PAPI.

```json
"lore": [
  "{i18n:btn_diamond.lore.line1}",
  "<gray>Prix : <yellow>%vault_eco_balance%</yellow> pièces</gray>",
  "{i18n:btn_diamond.lore.warning}"
]
```

Les clés vivent au niveau **workspace** (pas par pack ni par menu), stockées côté backend et exportées en JSON conforme à `translations/v1`. Schéma complet : `docs/schema/translations/v1/`.

### 10.4 Modèle de clés

- Slug hiérarchique avec `.` : `menu.shop_main.btn_buy.title`, `command.profile.description`, `common.errors.no_perm`.
- Validé par regex : `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$`.
- Un map `keys[clé][langue] = valeur MiniMessage` plat, lookup O(1).
- Une clé doit avoir au minimum la valeur dans la `default_lang` du workspace.

### 10.5 UX éditeur i18n

Sur tout champ texte, deux entry points pour insérer ou créer une clé sans quitter le contexte :

- **Touche `{`** déclenche un autocomplete fuzzy sur les clés du workspace. Sélection → insertion `{i18n:key}`.
- **Bouton `</>`** à droite du champ ouvre une popover avec recherche + bouton "+ Nouvelle clé".

**Auto-extract du texte existant** : tu tapes "Boutique" dans le champ titre, tu cliques "+ Nouvelle clé". L'éditeur (1) crée la clé `menu.shop_main.title` avec valeur FR = `"Boutique"`, (2) remplace le contenu du champ par `{i18n:menu.shop_main.title}`, (3) ouvre un mini-modal pour ajouter d'autres langues. Aucune navigation vers un autre écran.

**Édition d'une clé existante** : click sur la clé surlignée dans le champ → mini-modal avec les valeurs par langue et un live preview MiniMessage à côté.

**Détachement** : remplace `{i18n:key}` par la valeur courante en clair. La clé reste dans le workspace pour les autres usages.

**Validation d'unicité** au moment de la création, indicateur rouge live si collision avec une clé existante.

### 10.6 Génération auto des clés candidates

L'helper `generateAutoKey(ctx)` (cf. `translations/v1/types.ts`) suggère un slug basé sur le contexte d'édition :

| Contexte | Clé candidate |
|---|---|
| Titre de menu `shop_main` | `menu.shop_main.title` |
| Lore ligne 1 du bouton `btn_buy` du menu `shop_main` | `menu.shop_main.btn_buy.lore.1` |
| Description de commande `profile` | `command.profile.description` |
| Message de cooldown `heal_cmd` | `cooldown.heal_cmd.message` |

Si la clé existe déjà, suffixe automatique `_2`, `_3`...

### 10.7 Détermination de la langue active du joueur

Trois modes configurables dans `config.yml` côté plugin :

| Mode | Comportement |
|---|---|
| `server_default` | Tout le serveur parle une langue unique (la `default_lang` du workspace, override config possible). |
| `per_player_locale` *(recommandé)* | Langue dérivée de `Player#locale()` (locale Minecraft client). Mappée vers la langue workspace la plus proche, fallback `default_lang` si la traduction manque. |
| `per_player_placeholder` | Langue dérivée d'un placeholder PAPI custom (ex: `%player_lang%` si l'admin a déjà une commande `/lang` via un autre plugin). |

Le plugin charge toutes les traductions en mémoire au sync (les fichiers `i18n/<lang>.json` du bundle). Cache lookup O(1) à l'ouverture d'un menu.

### 10.8 Ordre de résolution à l'exécution

Quand un menu s'ouvre ou qu'une commande s'exécute, chaque champ texte traverse la chaîne :

1. **Résolution i18n** : `{i18n:key}` → valeur stockée pour la langue active du joueur. Fallback `default_lang` si manquant. Fallback texte vide + log warning si manquant en default aussi.
2. **Résolution PAPI** : `%player_name%`, `%vault_eco_balance%`, `%args_target%` (si ouvert depuis une commande), etc.
3. **Parse MiniMessage** : tags → Component Adventure final envoyé au client via Paper.

Conséquence : une **traduction peut elle-même contenir** des placeholders et des tags MiniMessage. Un texte direct (sans `{i18n:...}`) saute juste l'étape 1.

Limite de profondeur de résolution i18n = 10 (sécurité contre les références circulaires).

### 10.9 Pourquoi pas le `translatable_key` vanilla Minecraft

Tentant d'utiliser le système de translation natif de Minecraft (`assets/<ns>/lang/<locale>.json` dans le resource pack, résolu côté client). On préfère **server-side** :

- **Choix de la langue** : on peut imposer la langue (`server_default`) ou la dériver d'un placeholder (`per_player_placeholder`), pas seulement de la locale client.
- **Composition avec PAPI** : les placeholders sont résolus serveur-side avec le contexte joueur. Avec translatable_key vanilla, impossible de mélanger placeholders dynamiques (`%vault_eco_balance%`) avec une traduction.
- **Debug et logs** : on log les clés manquantes côté serveur, plus simple à diagnostiquer.
- **Pas de dépendance au reload du resource pack** côté client si on ajoute une langue.

Trade-off accepté : on perd la traduction natifs des items vanilla (mais on n'en a pas besoin — nos items custom sont des CMD strings qu'on contrôle).

### 10.10 Scope workspace + import de pack

Les clés vivent au niveau workspace. À l'**export** d'un pack `.itfz`, on calcule récursivement (`extractI18nRefsDeep`) l'union des clés référencées par les menus et commandes du pack, et on embarque ce sous-set comme `translations.json` à la racine de l'archive.

À l'**import** dans un autre workspace, on merge avec gestion des conflits (cf. `pack/v1/README.md`) :

- Clé absente localement → ajoutée.
- Clé présente, valeurs identiques → ignorée.
- Clé présente, valeur différente → conflit, dialog 3-way : *Garder local*, *Écraser*, *Renommer la clé importée* (auto-prefix `pack.id`). Default = renommer.

Pas de partage de clés entre workspaces de différents admins (chaque admin a son namespace isolé).

### 10.11 Pricing

Les clés i18n n'ont **aucun quota** dans aucun tier. Stockage négligeable (~quelques KB par workspace), runtime O(1) côté plugin. Ne fait pas partie des axes payants (cf. section 3).

---

## 11. Workflow Live / Draft

### 11.1 Cycle d'édition

```
[Admin ouvre menu existant dans l'éditeur]
              │
              ▼
[Draft initialisé = miroir de Live]
              │
              ▼
[Admin édite : drag, change asset, ajoute condition...]
              │
              │  (chaque modif → diff → WS → plugin met à jour le draft)
              ▼
[Plugin maintient un draft en mémoire, distinct de la live]
              │
              ▼
[Admin teste : /menu preview shop_main → voit le draft en jeu]
              │
              ▼
[Admin satisfait → clique "Publish"]
              │
              ▼
[Plugin reçoit l'ordre, archive l'ancienne live, écrit le nouveau bundle, bascule]
              │
              ▼
[Joueurs voient la nouvelle version]
```

### 11.2 Soft-lock multi-admin

Si deux admins ouvrent le même menu dans l'éditeur en même temps :

- Le premier obtient le contrôle (peut éditer).
- Les autres voient en read-only avec un indicateur "@admin1 en train d'éditer".
- Bouton "Take over" disponible pour reprendre la main (avec confirmation).

Pas d'édition collaborative à la Figma au MVP (operational transforms = projet à part entière). À envisager en v3 si la demande est forte.

### 11.3 Archive et rollback

Chaque publish archive automatiquement l'ancienne live. On garde les **5 dernières versions** par menu. Bouton "Rollback" dans l'éditeur, accessible depuis l'historique du menu. Rollback = re-publish d'une version archivée (sans perte des versions intermédiaires, qui restent dans l'historique).

### 11.4 Persistance du draft

- **Côté éditeur web** : autosave dans le serveur éditeur toutes les 10 secondes après modification, plus localStorage browser comme backup. Si le navigateur crashe, l'admin retrouve son draft.
- **Côté plugin** : si la WS tombe pendant que le draft est actif, le plugin garde son draft en mémoire pendant N minutes (configurable, défaut 30 min) puis le purge. La live n'est jamais affectée.

### 11.5 Reconnexion WS

Le plugin maintient une WS sortante vers l'éditeur. En cas de coupure :

- Reconnexion exponentielle (1s, 2s, 4s, 8s, 16s, max 60s).
- À la reconnexion, handshake qui inclut le hash du dernier bundle reçu. Si l'éditeur a un bundle plus récent, sync automatique.
- Tant que la WS est down : la live continue de servir, le draft reste en mémoire (pour la durée configurée), pas de panique côté admin.

---

## 12. Bibliothèque (assets, menus, commandes, templates) et organisation en packs

### 12.1 Sources d'assets

- **Mes uploads** : ce que l'admin a uploadé manuellement. Drag & drop multiple supporté.
- **Importé** : ce qu'on a extrait de packs externes. Drag & drop d'un .zip MCModels → l'éditeur parse, extrait les images, les organise dans un folder tagué `MCModels: <NomDuPack>`.
- **Marketplace** (v2) : assets/menus achetés via la marketplace native, importés en un clic.

### 12.2 Organisation

- **Folders user-created** (ex. `/shop`, `/quests`, `/lobby`).
- **Tags** (`button`, `icon`, `background`, `decoration`, `premium`...).
- **Search** par nom + tag avec filtre combinable.
- **Preview en grid** avec filtres (taille, date, used in / unused).
- **Métadonnées** : dimensions, date d'upload, nombre d'utilisations dans des menus.

### 12.3 Drag & drop dans les menus

Depuis l'asset library, l'admin glisse un asset directement sur un slot de l'éditeur de menu. L'asset est lié au slot par référence (path), pas copié. Une modification de l'asset propage à tous les slots qui l'utilisent.

### 12.4 Détection de doublons

À l'upload, hash MD5 calculé. Si l'asset est déjà présent (même hash), on demande à l'admin s'il veut écraser, dupliquer, ou ignorer. Évite l'accumulation de copies.

### 12.5 Cleanup d'assets non-utilisés

Vue "Unused assets" qui liste les assets jamais référencés dans aucun menu. Bouton "Delete unused" (avec confirmation). Aide à rester sous quota de stockage.

### 12.6 Workspace et packs

Le workspace de l'admin est organisé en **packs** : groupes thématiques qui contiennent ensemble des menus + commandes + templates + assets liés. Un pack répond à la question *"qu'est-ce qui va ensemble ?"* — typiquement, le système de shop tient dans un pack (avec ses commandes `/shop`, `/buy`), les menus de navigation principaux dans un autre, un pack acheté chez un créateur dans un troisième.

Chaque admin a un pack par défaut **Personal**, auto-créé, où atterrit tout ce qu'il crée tant qu'il n'assigne pas explicitement à un autre pack. Il peut créer autant de packs supplémentaires que besoin, chacun avec son propre nom et sa propre description.

Le dashboard affiche les packs comme des sections collapsables. Le contenu y est imbriqué par catégorie : `📦 Shop System (5 menus, 2 commandes)`, `📦 Daily Quests — acheté de @creator-x v2.1.0 (8 menus, 1 commande)`, etc. Créer un nouveau menu ou une nouvelle commande demande à l'admin dans quel pack le placer.

### 12.7 Source d'un pack : user-created, imported, forked

Chaque pack a une `source` qui détermine son comportement vis-à-vis des updates :

- **user_created** : créé localement par l'admin. Édition libre, jamais écrasé.
- **imported** : importé d'une archive `.itfz` (achat, partage Discord, MCModels). Lié à un `source_pack_id` et une `source_version`. Réimporter le même pack source **écrase tout son contenu en bloc** — pas de migration, pas de merge, pas de three-way. Les modifs locales sont perdues. L'admin voit un dialog d'avertissement clair.
- **forked** : pack imported que l'admin a forké pour le customiser durablement. À partir du fork, comportement identique à user_created (jamais écrasé) mais on garde le `source_pack_id` en métadonnée pour la traçabilité.

Le pattern est volontairement simple. Forker = "je prends, je customise, je perds le lien d'upgrade". Importer = "je veux suivre les updates de la source, peu importe mes changements". Connu de Steam Workshop, Notion templates, Figma communauté.

### 12.8 Format pack (export/import) — schéma `pack/v1`

Format d'export d'un pack : archive `.itfz` (zip avec extension renommée) contenant un `manifest.json` à la racine + dossiers `menus/`, `templates/`, `assets/` + optionnellement `preview.png` et `README.md`. Le manifeste suit le schéma `pack/v1` (cf. `docs/schema/pack/v1/`) qui décrit name, version semver, author, license, contenu listé, plugins requis, etc.

`requires_plugins` est calculé automatiquement à l'export depuis l'union des `metadata.uses_plugins` de chaque menu — pas saisi à la main.

À l'import, le backend :

1. Valide le manifeste contre `pack/v1`.
2. Vérifie que tous les fichiers listés sont dans l'archive.
3. Valide chaque menu contre `menu/v1` (et applique migrations si version antérieure).
4. Détecte les conflits : id de pack déjà présent (réimport ou rename), id de menu déjà présent ailleurs dans le workspace (conflit de namespace global, dialog rename/skip), plugins requis manquants (warning non-bloquant).
5. Vérifie que le tier de l'admin couvre les assets custom (sinon, propose d'importer en remplaçant les assets par des items vanilla).
6. Importe en draft, jamais directement en live — l'admin doit publish manuellement.

### 12.9 Cross-pack references — soft boundary

Un menu dans pack A peut référencer un template défini dans pack B sans erreur. À l'export du pack A, l'éditeur affiche un warning *"Ce pack référence le template `bouton_acheter` qui vit dans le pack B. Inclure pack B dans l'export ?"*. Si oui, B est embarqué dans la même archive ; sinon, l'export note la dépendance externe et l'import alerte si B est absent du workspace cible.

Modèle volontairement permissif (pas des modules stricts à la JS), pour ne pas friquer les workflows admins en pratique.

### 12.10 Vocabulaire à ne pas confondre

| Terme | Sens |
|---|---|
| **Pack** | Unité d'organisation dans le workspace (groupe de menus + templates + assets). Aussi : format d'export `.itfz`. |
| **Bundle** | Artefact runtime signé (config + resource pack) que le plugin télécharge depuis le CDN. Concept distinct, généré automatiquement par le backend, opaque pour l'admin. |
| **Menu** | Une entité ouvrable via `/menu open`. Vit à l'intérieur d'un pack. |

L'admin pense en packs ; le plugin reçoit des bundles ; les deux concepts ne se croisent jamais dans l'UI.

### 12.11 Redirections de menu (V2)

Quand un plugin tiers fournit un menu (cf. section 13.13), l'admin peut vouloir le **remplacer par un fork customisé** sans casser le fait que d'autres plugins/commandes ouvrent le menu original par son id namespace. Solution : table de redirections au niveau workspace.

```ts
WorkspaceMenuRedirect {
  source_menu_id: string;  // ex. "questx:quest_list"  ← l'id officiel du plugin
  target_menu_id: string;  // ex. "my_quests"          ← un menu user-owned du workspace
}
```

À l'exécution, Interfaze intercepte les `openMenu(menuId)` et applique la redirection avant de résoudre. Une seule redirection active par source. Les autres forks coexistent dans le workspace, accessibles par leur id direct (`/menu open my_quests_v2`) mais aucun call indirect ne les vise par défaut.

UX dans le canvas (cf. section 4.4) : la carte du menu plugin affiche un badge *"Redirigé vers `my_quests`"* si l'admin a setup une redirection. Click pour changer la cible (sélection parmi les forks du workspace) ou supprimer la redirection (revert au menu plugin original).

### 12.12 Mode slim vs full pour l'export pack

L'export d'un pack offre deux modes :

| Mode | Contenu du `.itfz` | Taille typique | Use case |
|---|---|---|---|
| **Slim** | Manifest + menus + templates + manifest. **Assets référencés par URL CDN** (ex. `https://cdn.interfaze.gg/u/iban/quest_btn.png`). | 10-100 KB | Embarqué dans un JAR plugin (cf. section 13.13). |
| **Full** | Manifest + menus + templates + assets binaires inclus | 1-50 MB | Marketplace V3, archive, partage offline-first. |

Les paths d'assets dans le menu JSON acceptent à la fois des chemins relatifs (résolus contre le dossier `assets/` du pack en mode full) ou des URLs HTTPS absolues (mode slim). Le moteur runtime pull les assets depuis l'URL et les sert via le resource pack côté joueur — le serveur lui-même n'a pas besoin de les avoir localement.

**Persistance des assets distribués via plugin** : pour les comptes qui ont publié leurs assets via un plugin (détecté à `registerMenuPack`), les assets sur le CDN restent **read-only à perpétuité** même si le compte est désactivé. Garantit la stabilité de l'écosystème plugin. À mentionner dans les ToS.

---

## 13. API d'intégration plugins tiers

### 13.1 Concept et enjeu stratégique

Permettre à des plugins externes (Quests, BetonQuest, ShopGUIPlus, Aurelium Skills, MMOCore, Jobs, LobbyCosmetics...) de **fournir des composants** (boutons single ou paginables, placeholders, actions custom) que l'admin peut utiliser dans ses propres menus. Le plugin tiers met aussi à disposition un ou plusieurs **layouts suggérés** qui servent de point de départ optionnel.

L'admin reste maître de sa composition : il décide où placer les composants, comment les styliser, et peut les mélanger librement avec ses propres slots et actions natives. Le plugin lui donne des outils ; il fait le menu.

Sans cette intégration, les serveurs RPG/quest qui dépendent de ces plugins ne peuvent pas migrer depuis zMenu/DeluxeMenus. Avec elle, on devient le standard de fait dès qu'un ou deux gros plugins (BetonQuest, ShopGUIPlus) intègrent l'API. C'est un effet de réseau classique de plateforme : chaque plugin qui intègre rend le produit incontournable pour ses utilisateurs.

### 13.2 API Java côté plugin tiers

```java
InterfazeAPI.register(
  PluginIntegration.builder("questx")

    // ----- Composants disponibles dans la palette de l'éditeur -----
    .addComponent(
      Component.builder("quest_button")
        .displayName("Bouton quête")
        .icon("paper")
        .paginable()                              // peut occuper plusieurs slots
        .placeholder("quest_name", ctx -> ctx.getQuest().getName())
        .placeholder("quest_progress", ctx -> ctx.getQuest().getProgressPercent())
        .placeholder("quest_price", ctx -> ctx.getQuest().getPrice())
        .defaultClickAction(new StartQuestAction())
        .defaultAsset("quest_btn.png")
        .defaultLore("§7{{quest_name}}", "§ePrix: §a{{quest_price}}$")
    )
    .addComponent(
      Component.builder("pagination_prev")
        .displayName("Page précédente")
        .single()
        .defaultClickAction(new PrevPageAction())
    )
    .addComponent(
      Component.builder("pagination_next")
        .displayName("Page suivante")
        .single()
        .defaultClickAction(new NextPageAction())
    )

    // ----- Layout suggéré (point de départ optionnel pour l'admin) -----
    .suggestedLayout("main", layout -> layout
      .title("Quêtes disponibles")
      .size(54)
      .place("questx:quest_button", slots(10, 43))    // paginé sur cette range
      .place("questx:pagination_prev", 45)
      .place("questx:pagination_next", 53)
    )
    .build()
);
```

Trois primitives clés :

- **Composants** (`Component`) : briques que l'admin pourra placer dans son menu. Mode `single` ou `paginable`. Chaque composant expose ses placeholders et son action par défaut au clic.
- **Placeholders** : variables résolues au rendu côté plugin tiers, utilisables dans les titles/lores des slots qui utilisent ce composant.
- **Layouts suggérés** : menus pré-remplis (combinaisons de composants placés à des positions données) qui servent de point de départ pour l'admin. Purement indicatif — l'admin peut les ignorer ou les modifier librement.

### 13.3 Modèle d'intégration

Le plugin tiers fournit deux choses à l'éditeur :

- **Une palette de composants** que l'admin peut utiliser dans n'importe quel menu, n'importe où.
- **Un ou plusieurs layouts suggérés** servant de point de départ optionnel.

L'admin construit son menu librement, en mélangeant composants du plugin tiers et briques natives (assets custom, actions natives). Pas de slots verrouillés, pas de zones réservées, pas de "delta sur base vivante" : c'est son menu, il en fait ce qu'il veut.

Conséquence importante : un menu qui utilise des composants tiers est un **menu standard** dans notre format. Certains slots référencent simplement un composant externe via `component_ref`, qui sera résolu au rendu par le plugin. Chaque menu est un artefact indépendant après création.

```json
{
  "schema": "menu/v1",
  "id": "my_quests_menu",
  "title": "Mes quêtes",
  "size": 54,
  "background": { "asset": "bg.png" },
  "layers": [
    {
      "id": "default",
      "name": "Default",
      "elements": [
        {
          "id": "header",
          "positions": "4",
          "appearances": [{ "asset": "header.png", "title": "§6QUÊTES" }]
        },
        {
          "id": "quests_list",
          "positions": "10-43",
          "appearances": [
            {
              "component_ref": "questx:quest_button",
              "asset": "quest_btn.png",
              "lore": ["§7{{questx:quest_name}}", "§ePrix: §a{{questx:quest_price}}$"]
            }
          ]
        },
        {
          "id": "btn_prev",
          "positions": "45",
          "appearances": [
            {
              "asset": "arrow_left.png",
              "click": { "left": { "actions": [{ "type": "pagination_prev" }] } }
            }
          ]
        },
        {
          "id": "btn_next",
          "positions": "53",
          "appearances": [
            {
              "asset": "arrow_right.png",
              "click": { "left": { "actions": [{ "type": "pagination_next" }] } }
            }
          ]
        }
      ]
    }
  ],
  "metadata": { "uses_plugins": ["questx"] }
}
```

Au rendu : le plugin résout chaque `component_ref` vers la déclaration courante du composant côté plugin tiers, applique les placeholders avec le contexte du joueur, et exécute l'action par défaut au clic (ou l'override si l'admin l'a remplacée). Le champ `metadata.uses_plugins` est calculé automatiquement par l'éditeur, utilisé pour les warnings au publish (cf. section 13.9).

### 13.4 Composants fournis par le plugin

Chaque composant déclaré par un plugin tiers expose :

- **ID namespacé** (`questx:quest_button`) — référence unique, non collisionnable.
- **Métadonnées** : displayName, icône, description (utilisés dans la palette de l'éditeur).
- **Mode** : `single` (un slot) ou `paginable` (rangée de slots, le moteur génère N instances pour les N éléments à afficher dynamiquement).
- **Placeholders** : variables dynamiques résolues au rendu (`{{questx:quest_name}}`, `{{questx:quest_progress}}`).
- **Action par défaut au clic** : ce qui se passe quand l'admin n'a pas overridé (ex. `start_quest`).
- **Defaults d'apparence** : asset, lore, title proposés par défaut. L'admin peut les overrider individuellement.

L'admin utilise les composants comme des briques, librement :

- **Drag & drop depuis la palette** vers un slot (ou une rangée de slots, pour un paginable).
- **Modification de l'apparence** : asset, lore, title — tout est éditable par-dessus les defaults du composant.
- **Modification du click** :
  - Garder le default du composant : `use_component_default: true`.
  - Override complet : définir ses propres `actions` (le default n'est pas exécuté).
  - Composition : exécuter le default puis ses propres actions (`{ "use_component_default": true, "then_actions": [...] }`).
- **Choix d'utiliser ou non** : l'admin peut faire un menu sans utiliser tel composant disponible, ou réutiliser le même composant à plusieurs endroits.

Pour les composants paginables, l'admin sélectionne une rangée de slots (ex. `"10-43"`), assigne un composant paginable, et le moteur génère automatiquement les instances pour les N éléments à afficher selon le contexte du joueur. Les boutons `pagination_prev` et `pagination_next` (composants `single`) sont placés où l'admin veut, indépendamment de la rangée paginée.

### 13.5 Layouts suggérés : point de départ optionnel

Le plugin tiers déclare un ou plusieurs **layouts suggérés** : des menus pré-remplis prêts à l'emploi, montrant des combinaisons utiles de ses composants. C'est purement indicatif.

Dans l'éditeur :

- **Spawn from suggested** : l'admin clique pour créer un nouveau menu pré-rempli avec un layout suggéré. Il en hérite comme point de départ et le modifie ensuite à sa guise. Le menu créé est ensuite indépendant — il n'a plus aucun lien automatique avec le layout suggéré.
- **Voir les layouts suggérés** : preview en read-only des layouts courants du plugin, utile si l'admin veut comprendre les recommandations sans repartir de zéro.
- **Comparer avec un suggéré** : diff visuel entre le menu courant et un layout suggéré, purement informatif.

Pas de mécanisme de re-sync ou de "reset partiel" sur les composants. Un menu, une fois créé, est la propriété de l'admin. Si le plugin update et propose de nouveaux layouts suggérés, ils apparaissent simplement dans la liste des "Spawn from suggested" disponibles, sans impact sur les menus existants. L'admin peut spawn un nouveau menu à partir du nouveau suggéré et migrer manuellement ce qu'il veut conserver.

Cette simplicité est délibérée : on traite les menus comme des artefacts indépendants après création, pas comme des "instances vivantes" du plugin tiers.

### 13.6 Cycle de vie des updates plugin

Le principe directeur est la **transparence** : quand le plugin tiers passe en nouvelle version, l'admin n'est pas notifié, rien ne s'arrête. Le système se débrouille pour rester cohérent.

Concrètement :

- **Nouveaux composants ou placeholders** : ils deviennent simplement disponibles dans l'éditeur (palette de composants, autocomplete des placeholders). L'admin les découvre quand il édite, peut les utiliser s'il veut. Aucune notification, aucune popup.
- **Layouts suggérés modifiés ou ajoutés** : ils apparaissent dans la liste des "Spawn from suggested". Aucun impact sur les menus existants.
- **Composant renommé ou supprimé** : si un menu de l'admin référence un `component_ref` qui n'existe plus, le slot concerné est ignoré silencieusement au rendu. L'admin le découvre quand il rouvre l'éditeur (le slot apparaît grisé avec un libellé "indisponible") et peut le supprimer ou le remplacer.
- **Placeholder renommé ou supprimé** : si un placeholder n'est plus fourni, son rendu retourne une chaîne vide. Pas d'erreur en jeu, juste un blanc visible que l'admin corrigera quand il le verra.

La règle : **le menu de l'admin est la source de vérité**, le plugin tiers fournit ce qu'il fournit, on combine au rendu, on ignore ce qui manque. Cette approche assume une qualité minimale des plugins tiers (ils ne suppriment pas des composants tous les 2 jours), mais accepte que des incohérences ponctuelles soient gérées passivement plutôt que par des wizards intrusifs.

### 13.7 Découverte des plugins disponibles

Pull simple via le WebSocket : au boot du plugin (ou à chaque `/menu reload`), il transmet à l'éditeur la liste des plugins tiers détectés, leurs MenuTemplates, et leurs versions. L'éditeur affiche dans le compte de l'admin uniquement les plugins effectivement installés sur le serveur connecté.

Conséquences :

- Toujours synchro avec la réalité du serveur.
- Pas de registry cloud à maintenir, pas de coordination avec les auteurs de plugins.
- Compromis : si l'admin a plusieurs serveurs (network), un plugin installé sur le serveur A n'apparaît pas dans l'éditeur quand il est connecté au serveur B. À documenter clairement.

Pour les serveurs dev/staging : l'admin doit installer le plugin tiers aussi sur son environnement de dev pour pouvoir l'éditer. Friction acceptable, équivalente à ce qui existe avec zMenu/DeluxeMenus aujourd'hui.

### 13.8 Conflit de namespace et collisions

- Tout slot type, placeholder, action est **obligatoirement préfixé** par le namespace du plugin (`questx:quest_button`, pas `quest_button` seul).
- Au registration, l'API rejette les déclarations qui violent cette règle avec un message clair pour le dev.
- Deux plugins peuvent avoir le même nom local s'ils ont des namespaces différents : `questx:main` et `betonquest:main` coexistent sans souci.

### 13.9 Edge cases

- **Plugin désinstallé** : le menu reste dans le compte de l'admin (côté éditeur), mais devient "orphelin" et ne peut plus être publié. Notification : "QuestX désinstallé. Le menu est en pause. Réinstalle pour continuer." Le delta est conservé pour reprendre si l'admin réinstalle.
- **Plugin présent en prod, absent en dev** : l'admin voit le menu sur le serveur de prod mais pas sur le dev. Il doit installer le plugin sur dev pour éditer.
- **Versions différentes entre serveurs d'un network** : si serveur A est en QuestX 2.0 et serveur B en 1.5, et qu'un menu utilise un composant introduit en 2.0 (`questx:quest_filter`), le composant sera ignoré silencieusement au rendu sur le serveur B. Au publish, l'éditeur détecte la situation grâce à `metadata.uses_plugins` et peut warn (info, pas blocant) : "Ce menu utilise QuestX 2.0+, mais serverB a QuestX 1.5. Certains composants seront ignorés." L'admin choisit de publier quand même, ou d'updater le plugin sur serverB.
- **Plugin tiers buggué** : si le plugin tiers crash au registration, l'éditeur n'a pas accès aux MenuTemplates. Les menus existants restent en lecture seule, l'admin est notifié. Pas d'impact sur les autres plugins.

### 13.10 Use cases populaires à valider

L'API doit supporter les patterns suivants, validés contre les plugins majeurs du marché :

| Plugin | Pattern central |
|---|---|
| Quests, BetonQuest | Liste paginée de quêtes + détail par quête + actions accept/abandon/claim |
| ShopGUIPlus, EconomyShopGUI | Catégories → items paginés + actions buy/sell + variations de prix |
| Jobs, EcoJobs | Liste de jobs + leveling display + xp progress |
| MMOCore, MMOItems | Skill trees + inventory custom + class selection |
| Aurelium Skills | Skill display + leaderboards + reward menus |
| LobbyCosmetics | Catégories de cosmétiques + preview + équiper/déséquiper |
| LuckPerms (admin) | Browse permissions + assign/remove tracks + group management |

Chaque plugin a ses spécificités, mais le pattern de base "liste paginée + détail + actions custom" couvre 80% des cas. L'API supporte ce pattern via les composants en mode `paginable` (rangée de slots dynamiques).

### 13.11 Intégrations natives Nexo / ItemAdder (V1.5)

Killer feature post-MVP : les items et textures custom déclarés dans Nexo ou ItemAdder apparaissent directement dans la palette de l'éditeur, sans aucune duplication ni re-upload.

**Use case typique** : un admin a un serveur Survival/RPG avec 200 items custom dans Nexo (épées, armures, ressources). Pour faire son shop, il drag-and-drop ses items Nexo directement dans les slots du menu. Fini la duplication d'assets entre plugins, fini la maintenance en double.

**Deux modes d'intégration** :

- **Mode item** (recommandé) : l'admin pose un item Nexo sur un slot. Le format stocke `material: "nexo:custom_sword"`. Le rendu en jeu utilise directement l'item Nexo (sa texture, son CMD, son comportement, son lore Nexo). Aucune duplication côté nous. Cohabitation native grâce au pack stacking 1.21.4+ — notre pack et celui de Nexo coexistent sans conflit.
- **Mode texture seule** : pour les usages décoratifs (header de menu, séparateur, ornement), l'admin peut drag une texture Nexo qui est copiée dans notre pack et indexée comme un asset standard. L'attribution est gardée en metadata (utile pour la traçabilité).

**Découverte côté plugin** :

Au boot et à chaque `/menu reload`, le plugin scanne :

- **Nexo** : via l'API publique (`NexoItems.entries()`) si disponible, sinon par lecture des configs (`plugins/Nexo/items/*.yml`).
- **ItemAdder** : via l'API publique si disponible, sinon par lecture des configs (`plugins/ItemsAdder/contents/*/configs/*.yml`).

La liste (items + textures + métadonnées : namespace, catégorie, displayname, lore par défaut, CMD) est pushée à l'éditeur via WS. L'asset library affiche deux sources dédiées :

- **Nexo** : organisée par catégorie déclarée dans Nexo (weapons, armors, resources, blocks...).
- **ItemAdder** : organisée par namespace ItemAdder.

Sources read-only avec preview en grid, search, drag-drop direct vers un slot. Refresh automatique quand l'admin ajoute un item à Nexo/ItemAdder et fait `/menu reload`.

**Format intermédiaire** :

Le champ `material` d'un Element accepte les IDs namespacés sans changement de structure :

```json
{
  "id": "btn_legendary_sword",
  "positions": "15",
  "appearances": [
    {
      "material": "nexo:custom_sword",
      "title": "Épée légendaire",
      "lore": ["§7Lame mythique forgée", "§ePrix: §a5000$"],
      "click": {
        "left": {
          "requirements": [{ "type": "has_money", "amount": 5000 }],
          "actions": [
            { "type": "take_money", "amount": 5000 },
            { "type": "give_item", "material": "nexo:custom_sword", "count": 1 }
          ]
        }
      }
    }
  ]
}
```

Résolution au rendu : prefix `nexo:` → résolution via Nexo, prefix `itemadder:` → résolution via ItemAdder, sinon vanilla. Si le plugin source est désinstallé ou l'item supprimé, l'Element affiche "indisponible" (dégradation gracieuse, même pattern qu'en section 13.6).

L'action `give_item` accepte également les materials namespacés, ce qui rend les flows shop / récompense de quête transparents avec Nexo/ItemAdder.

**Pourquoi V1.5 et pas MVP ?**

- Permet de ship plus vite le core editor et de valider l'adoption avant d'investir dans une intégration profonde.
- Permet d'observer la distribution réelle des admins dans la base d'utilisateurs (% qui utilisent Nexo, % ItemAdder, % ni l'un ni l'autre) avant de calibrer.
- Mais à prioriser dès la stabilisation MVP : la majorité de l'écosystème RPG/Survival passe par ces plugins, c'est un argument de vente massif pour ce segment.

**Effet stratégique** :

Cette intégration capture le segment RPG/Survival, qui représente une fraction très significative du marché des serveurs sérieux. Sans elle, ces admins doivent jongler entre Nexo/ItemAdder pour leurs items et un autre plugin pour leurs menus, avec re-upload manuel des textures. Avec elle, notre plugin devient leur front-end de menus naturel pour tout leur contenu existant — plus aucune raison de rester sur zMenu/DeluxeMenus.

### 13.12 Stratégie d'adoption

L'API ne sert à rien si aucun plugin tiers ne l'intègre. Plan d'adoption :

- **Documentation et SDK** : Java + Kotlin examples, tutoriel "intégrer ton plugin en 30 minutes", javadoc complète.
- **Reference implementations** : forker un ou deux plugins open source connus et y intégrer l'API en exemple. Idéalement avec leur accord, sinon en guides séparés.
- **Outreach direct aux auteurs majeurs** : contacter les maintainers de BetonQuest, ShopGUIPlus, MMOCore en amont du launch, leur offrir un accès premium gratuit à vie en échange d'une intégration dans les 3 mois post-launch.
- **Discord développeurs** : canal dédié pour les questions API, support prioritaire.
- **Showcase sur le site** : page "Plugins compatibles" qui liste les intégrations et leur niveau de maturité.

### 13.13 Plugins enregistrent des menus complets (V2)

En V1, les plugins fournissent des **composants** (boutons single ou paginables) que l'admin compose dans ses propres menus. En V2, l'API tierce s'élargit : les plugins peuvent enregistrer des **menus complets** dans le workspace de l'admin via :

```java
interfaze.registerMenuPack(byte[] packArchive);
```

Le plugin lit son `.itfz` embarqué dans son JAR (typiquement `resources/interfaze-pack.itfz`), passe les bytes à l'API au `onEnable`. Interfaze parse l'archive, valide contre `pack/v1`, et enregistre les menus sous le **namespace du plugin appelant** (auto-dérivé via `Plugin.getName()` côté Bukkit) — `questx:quest_list`, `questx:quest_detail`, etc. Aucun namespace à déclarer manuellement.

**Workflow plugin dev :**

1. Sign up sur `editor.interfaze.gg` (compte free OK)
2. Designe ses menus dans l'éditeur visuellement, comme n'importe quel admin
3. Upload ses assets custom (vont sur le CDN R2 sous son compte)
4. Exporte le pack en mode **slim** (cf. 12.12) — JSON only, assets référencés par URL CDN. Taille typique : 30-100 KB.
5. Embarque le `.itfz` dans son JAR
6. Code Java minimal : lire les bytes, appeler `registerMenuPack`. Le plugin n'a plus à écrire un seul ligne de YAML/JSON manuel pour ses menus.

**Côté admin :**

- Les menus enregistrés par les plugins apparaissent sur le canvas (cf. 4.4) avec un styling distinct (bordure colorée, badge "fourni par questx").
- L'admin peut **fork** un menu plugin pour le customiser, créant un menu user-owned dans son workspace. Le fork perd le lien d'upgrade avec la source.
- L'admin peut **rediriger** : *"quand quelque chose ouvre `questx:quest_list`, ouvre `my_quests` à la place"* (cf. 12.11).
- L'admin **ne peut pas éditer** un menu plugin non-forké directement — le plugin a la main dessus.

**Bénéfices stratégiques :**

- Les plugin devs deviennent users d'Interfaze (eat your own dogfood, multiplier l'adoption).
- Plus de YAML hardcodé dans les plugins → meilleure UX pour eux.
- Les assets des plugins remplissent le CDN d'Interfaze → effet de réseau (admins découvrent des assets gratuitement).
- Networks d'admins voient leur graphe de menus complet (leurs propres menus + les menus plugins) sur un seul canvas.

À documenter en V2 dans la section dédiée plugin dev de `docs.interfaze.gg`.

---

## 14. Commandes

Interfaze permet à l'admin de **créer ses propres commandes** depuis l'éditeur, au même niveau qu'un menu. Une commande est une entité de premier ordre : elle a son id, son nom, ses arguments, ses actions, et vit dans le même workspace que les menus (et le même pack `.itfz` à l'export).

Concept analogue à un `commands.yml` ou à un plugin de commandes custom (CommandPanels, etc.), mais avec :

- Le **catalogue d'actions du menu** réutilisé tel quel (cf. section 5).
- Un **système d'arguments typés** avec tab-completion automatique.
- Un **contexte d'arguments** propagé aux menus ouverts depuis la commande.
- L'éditeur visuel : pas de YAML à taper, validation live, hints de placeholders.

### 14.1 Modèle

Une commande contient :

- **Métadonnées** : `id` (slug interne), `name` (tapé en jeu sans slash), `aliases[]`, `permission`, `description` (visible joueur), `notes` (interne admin).
- **Arguments** : liste ordonnée d'arguments positionnels typés.
- **Requirements** : conditions ANDées avant exécution (mêmes types qu'en menu).
- **Actions** : la séquence à exécuter (mêmes 15 types qu'en menu).
- **Fallback** : actions exécutées si requirements échouent.
- **Cooldown** : optionnel, scope `player` ou `server`.

Schéma complet : `docs/schema/command/v1/`.

### 14.2 Types d'arguments (V1)

8 types initiaux, suffisants pour les use cases courants :

| Type | Sens | Tab-completion |
|---|---|---|
| `player` | nom de joueur (online ou offline, résolu via UUID) | online + connus du serveur |
| `online_player` | nom de joueur connecté | online uniquement |
| `string` | texte libre | aucune |
| `integer` | entier | aucune |
| `number` | nombre flottant | aucune |
| `boolean` | true/false | true, false |
| `world` | nom d'un monde chargé | mondes chargés |
| `enum` | valeur dans une liste fixée par l'admin | valeurs de la liste |

Chaque argument a un nom (slug), un flag `required` (par défaut true), et optionnellement un `default` qui supporte les placeholders (utile pour `%player_name%` quand l'admin veut cibler l'auteur de la commande par défaut).

Règle d'ordre : les `required` doivent précéder les optionnels. L'éditeur l'applique au drag-and-drop.

V2+ ajoutera : `item_material`, `enchantment`, `entity_type`, `region` (depuis WorldGuard), suggestions custom via placeholders dynamiques.

### 14.3 Contexte et placeholders

Quand la commande s'exécute, les arguments sont parsés selon leur type. Un échec de parse (joueur introuvable, monde non chargé, valeur enum invalide) envoie un message d'erreur typé au joueur et la commande n'est **pas exécutée** (pas de fallback, c'est de l'input invalide, pas un requirement raté).

Une fois parsés, les arguments deviennent disponibles via deux formes de placeholders :

- `%args_<name>%` : valeur primaire en string (nom du joueur, valeur enum, nombre).
- `%args_<name>_<champ>%` : champs dérivés sur les types complexes.

Champs dérivés en V1 :

| Type | Champs |
|---|---|
| `player` / `online_player` | `_uuid`, `_displayname` |

Ces placeholders sont **enregistrés dynamiquement** dans le moteur PlaceholderAPI au moment où la commande ouvre un menu, et nettoyés à la fermeture. Ils coexistent avec les placeholders standards (`%player_name%`, `%world%`, etc.) et sont utilisables dans :

- Les `actions` et `fallback` de la commande elle-même (ex: `run_command "eco give %args_target% %args_amount%"`).
- Les `requirements` de la commande (ex: `placeholder_match %args_target_uuid% ...`).
- Toute apparence, click handler, ou action du menu ouvert depuis la commande.

### 14.4 Propagation du contexte

Une `open_menu` action propage le contexte d'arguments **par défaut**. Quand le menu ouvert chaîne un autre menu via `open_menu`, le contexte continue à se propager.

Pour couper la propagation (ex: bouton "Retour à l'accueil" qui ne doit pas hériter d'un target spécifique) :

```json
{ "type": "open_menu", "menu_id": "main_menu", "clear_context": true }
```

Decision : par défaut **false** (propage), parce que le cas le plus fréquent est de chaîner un sous-menu qui hérite du contexte (ex: profile → inventaire de profile, pour le même target). Le clear est explicite et rare.

### 14.5 Use cases couverts

Avec ce modèle, l'admin peut couvrir sans plugin tiers :

- `/heal` → actions directes, pas de menu (`give_xp`, `play_sound`, `send_message`).
- `/profile [target]` → ouvre `profile_menu` avec contexte.
- `/shop` → ouvre `shop_menu` (alias court, équivalent à `/menu open shop`).
- `/pay <player> <amount>` → take_money + run_command (eco) + send_message.
- `/warp <name>` avec `name` typé `enum` → liste de warps autocomplétée.
- `/admin-give <player> <material>` (perm admin) → give_item au joueur cible.

### 14.6 Conflits de noms

Au démarrage, le plugin détecte les conflits avec les commandes déjà enregistrées sur le serveur :

- **Vanilla** (`heal`, `tp`, etc. natives ou via `commands.yml`) : Interfaze refuse de les overrider, log un warning, demande à l'admin de renommer.
- **Autre plugin** : pareil, refus + warning visible dans les logs.
- **Conflit interne** entre deux commandes Interfaze (même nom dans deux packs activés) : dernier chargé perd, log un warning, l'admin est notifié dans l'éditeur.

Pas d'override silencieux jamais — un admin doit toujours savoir quelle commande est active pour quel nom.

### 14.7 Pricing

Les commandes **n'ont pas de quota** dans aucun tier. Une commande coûte ~1 KB de stockage et zéro runtime (pas de rendu, pas de WS persistant). Les quotas Interfaze sont sur les serveurs liés et les seats d'équipe, pas sur les ressources de contenu (cf. section 3).

### 14.8 Workspace et packs

Les commandes apparaissent dans le dashboard à côté des menus, avec leur propre onglet/filtre. Sur le canvas multi-menu (cf. section 4.4), une commande est représentée comme un nœud distinct (forme/couleur dédiée), avec une flèche vers le menu qu'elle ouvre (s'il y en a un — sinon nœud "feuille").

À l'export `.itfz`, le manifest pack inclut une section `commands[]` à côté de `menus[]`. Cf. `docs/schema/pack/v1/`.

### 14.9 Limites V1

- Pas d'arguments **variadic** (ex: `/say <message...>`). Le dernier `string` capture tous les tokens restants par convention si on en a besoin, mais pas de syntaxe spéciale en V1.
- Pas de **subcommands** branchées (ex: `/admin give|kick|ban`). À traiter via plusieurs commandes nommées (`/admin-give`, `/admin-kick`) ou un menu d'admin.
- Pas de **suggestions custom** dynamiques au-delà de `enum`. À ajouter en V1.5+.
- Pas de **commands chaînées** (une commande qui appelle une autre commande). Possible via `run_command` mais ça repasse par le parser texte, pas idéal.

---
## 15. Authentification et équipes

### 15.1 Login

**Discord OAuth** comme méthode principale. Choix culturellement aligné : 99% des admins Minecraft sont déjà sur Discord.

### 15.2 Recovery email

À la création du compte, l'admin lie un email (non-Discord) de récupération. En cas de perte d'accès Discord (ban, compte suspendu), procédure manuelle de support :

1. L'admin contacte le support depuis l'email de récupération.
2. Vérification d'identité (preuve d'ownership des serveurs Minecraft : commande sur les serveurs liés, screenshot, etc.).
3. Re-binding manuel sur un nouveau compte Discord.

### 15.3 Multi-utilisateur (équipes)

Dans la spec V1, deux niveaux :

- **Compte solo** : un seul utilisateur, tier Solo ou Network.
- **Compte team** : plusieurs membres, possible sur tous les tiers payants. Les membres sont identifiés via Discord :
  - **Méthode 1** : invitation par username Discord.
  - **Méthode 2** (élégante) : "tous les membres avec le rôle @admin sur mon serveur Discord" — l'éditeur écoute les changements de rôle Discord.

Permissions internes au compte : Owner (tout), Admin (édite et publie), Editor (édite, ne peut pas publier), Viewer (read-only).

### 15.4 Sessions

JWT avec rotation. Session valide 7 jours, refresh transparent. Si la connexion Discord est révoquée (ban), la session expire à la prochaine validation.

---

## 16. Protocole WebSocket

### 16.1 Handshake

Connexion sortante du plugin vers `wss://editor.interfaze.gg/ws/plugin`. Authentification via :

```json
{
  "type": "hello",
  "server_key": "sk_xxxxxxxxxxxx",
  "plugin_version": "1.0.0",
  "minecraft_version": "1.21.4",
  "current_bundle_hash": "sha256:abc..."
}
```

L'éditeur valide la `server_key`, vérifie l'unicité d'usage (fingerprint serveur), et répond :

```json
{
  "type": "hello_ack",
  "session_id": "sess_xxxxxx",
  "server_id": "srv_xxxxxx",
  "tier": "network",
  "needs_sync": true | false,
  "latest_bundle_hash": "sha256:def..."
}
```

### 16.2 Messages éditeur → plugin

| Message | Description |
|---|---|
| `bundle_available` | Nouveau bundle prêt sur le CDN, URL fournie + signature |
| `draft_update` | Mise à jour incrementielle du draft d'un menu |
| `publish` | Promouvoir un draft en live |
| `rollback` | Revenir à une version archivée |
| `placeholder_query` | Demande la liste des placeholders PAPI installés |
| `permission_query` | Demande la liste des permissions disponibles (LuckPerms, Vault) |
| `material_query` | Demande la liste des matériaux/items du serveur |

### 16.3 Messages plugin → éditeur

| Message | Description |
|---|---|
| `sync_complete` | Bundle reçu et activé |
| `sync_failed` | Erreur, raison |
| `placeholder_response` | Liste des placeholders disponibles |
| `permission_response` | Liste des permissions |
| `material_response` | Liste des matériaux |
| `event_menu_opened` | Métriques (qui a ouvert quel menu, quand) |
| `event_action_executed` | Métriques (action déclenchée, succès/échec) |

### 16.4 Reconnexion

Côté plugin : reconnexion exponentielle (1s, 2s, 4s, 8s, 16s, max 60s). À la reconnexion, le handshake inclut `current_bundle_hash` ; si l'éditeur a une version plus récente, push de `bundle_available`.

### 16.5 Robustesse

- Messages idempotents quand possible (un `live_publish` re-reçu ne casse rien).
- Heartbeat (`ping`/`pong`) toutes les 30 secondes.
- Buffer des messages côté éditeur si le plugin est déconnecté (max 100 messages, dropped sinon avec un fallback "fait un sync complet").

---

## 17. Stack technique

### 17.1 Plugin Minecraft

- **API** : Paper API (depuis 1.21.4), avec compatibilité Spigot. Préférer Paper pour les events plus riches et la perf.
- **Langage** : Java 21 (LTS, requis par 1.21+) ou Kotlin (moderne, concis).
- **Build** : Gradle, plugin paper-userdev pour le mojmap.
- **Dépendances clés** :
  - Vault (économie, optionnelle au load)
  - PlaceholderAPI (placeholders, optionnelle au load)
  - WorldGuard (régions, optionnelle)
  - LuckPerms (permissions, optionnelle)
- **Persistence** : H2 ou SQLite embedded pour les cooldowns, métadonnées de bundles. Config `.yml` minimal (server_key, port HTTP local, tier override pour debug).

### 17.2 Éditeur web

- **Frontend** : React 18+ avec Vite. TypeScript strict.
- **Drag & drop** : `@dnd-kit/core` (performant, accessible, moderne).
- **State** : Zustand ou Jotai (léger, suffisant). Redux écarté (overkill).
- **UI components** : shadcn/ui ou Mantine (esthétique soignée nécessaire pour le positionnement).
- **WebSocket client** : connection management custom + auto-reconnect.

### 17.3 Backend éditeur

- **Runtime** : Node.js 20+ avec TypeScript.
- **Framework** : Fastify (perf et type-safe) ou Hono (moderne, edge-ready).
- **DB** : PostgreSQL pour les comptes, bundles, métadonnées. Redis pour les sessions et le state WebSocket.
- **Storage assets** : S3-compatible (Cloudflare R2 conseillé pour les coûts, pas de fees egress).
- **CDN** : Cloudflare devant le storage (cache agressif, réseau global).
- **Auth** : Discord OAuth via NextAuth ou implémentation custom légère.
- **Paiement** : Stripe Subscriptions.
- **Génération de packs** : workers Node + librairie sharp pour le redimensionnement, archiver pour le .zip.

### 17.4 Infra

- **Hosting** : Fly.io ou Railway pour le backend (simple, scalable, multi-région).
- **DB managée** : Supabase (PostgreSQL + auth assist) ou Neon (serverless Postgres).
- **CDN** : Cloudflare.
- **Monitoring** : Sentry (errors), Plausible ou PostHog (analytics produit).
- **CI/CD** : GitHub Actions.

### 17.5 Sécurité

- Tous les tokens en HttpOnly cookies (jamais localStorage).
- Server keys hashed côté backend (Argon2).
- Bundles signés avec ECDSA P-256.
- Rate limiting sur l'API (par compte et par IP).
- Validation stricte des uploads (PNG only, magic bytes check, taille).
- Sandbox des assets parsing (parser MCModels en worker isolé).

---

## 18. Distribution / GTM

### 18.1 Plugin gratuit (vanilla)

Distribué partout pour maximiser l'adoption :

- **SpigotMC** : la plus grande audience (~250k+ admins actifs). Distribuer ici en priorité.
- **Modrinth** : moderne, en croissance, public Paper-friendly. Bon complément.
- **Page de téléchargement directe** sur le site (pour SEO et pour ceux qui ne passent pas par les hubs).

Note : SpigotMC interdit les modèles d'abonnement. La version premium ne peut pas y être listée ; seule la version vanilla l'est.

### 18.2 Premium (subscription)

Distribué uniquement via :

- **Compte éditeur** : l'admin upgrade depuis son dashboard, paiement Stripe.
- **Page de pricing** sur le site.
- **Bouton "Upgrade"** intégré dans l'éditeur, déclenché dès qu'on essaye d'utiliser un asset custom en mode gratuit.

Possibilité future :

- **BuiltByBit** : pour vendre des packs de menus prêts (une fois la marketplace opérationnelle). Audience qualifiée.
- **Polymart** : alternative possible, moins prioritaire.

### 18.3 Marketing au launch

- **Démo serveur public** : `mc.interfaze.gg`. N'importe qui peut se connecter et tester le plugin en action. Le manque de démo de NxMenu est un avantage concurrentiel concret.
- **Vidéo showcase** (2-3 minutes) : édition live (la WS est un feature visuel imbattable), construction d'un menu shop en 5 minutes, démo de cohabitation avec Nexo.
- **Discord communautaire** : support, feedback, partage de configs entre utilisateurs (germe de communauté avant la marketplace).
- **Présence Reddit** : `r/admincraft`, `r/Minecraft` — post de release puis showcases hebdomadaires.
- **Outreach YouTubers Minecraft** : créateurs de tuto serveurs (français et anglophones), envoi du plugin gratuit + accès premium pour test.
- **Blog technique** : 1-2 articles initiaux ("comment on a résolu la cohabitation avec Nexo", "pourquoi on a choisi 1.21.4+"). SEO + crédibilité dev.

### 18.4 Métriques de succès post-launch

- **Adoption (mois 1)** : >1000 téléchargements vanilla.
- **Adoption (mois 3)** : >5000 serveurs actifs (plugin chargé et utilisé).
- **Conversion premium (mois 3)** : >5% des serveurs actifs upgradent.
- **Churn premium** : < 10% mensuel à 6 mois.
- **NPS éditeur** : > 40.

---

## 19. Scope MVP explicite

### 19.1 Inclus dans le MVP (V1)

Toute la fondation du produit décrite ci-dessus :

- Éditeur web complet (mode unifié à divulgation progressive + Export/Import JSON).
- Schéma JSON versionné, documenté, AI-ready (TypeScript types + JSON Schema publiés).
- WebSocket persistant avec édition live.
- Workflow Live / Draft avec rollback.
- **Workspace organisé en packs** (Personal auto-créé + packs user-created), avec assignation des menus/commandes/templates/assets à un pack. Pas encore d'export/import de pack en V1 — uniquement export d'un menu seul (.menu.json) ou d'une commande seule (.cmd.json).
- **Canvas multi-menu** (cf. section 4.4) : vue Figma-like avec cartes des menus et flèches `open_menu` auto-dérivées. Toggle "List/Canvas" dans la toolbar du dashboard. React Flow comme librairie de canvas. Implémentation cadrée parce que le code est généré par AI assist — quelques heures à quelques jours de plus que la List view.
- **Commandes custom** (cf. section 14) : entité de premier ordre alongside les menus. Arguments typés avec tab-completion (8 types initiaux), requirements + fallback + cooldown, contexte d'arguments propagé aux menus ouverts via placeholders `%args_<name>%`. Pas de quota — illimitées dans tous les tiers.
- **Format texte unifié MiniMessage + i18n** (cf. section 10) : tous les champs texte (titres, lores, messages, descriptions de commandes) sont en MiniMessage avec preview live dans l'éditeur. Système d'i18n inline `{i18n:key}` scoped au workspace, avec création/édition de clés sans quitter le contexte d'édition (touche `{` pour autocomplete, "+ Nouvelle clé" pour créer avec auto-extract du texte courant). Modes serveur : langue unique, locale joueur (recommandé), ou placeholder PAPI. Pas de quota sur les clés, illimitées dans tous les tiers.
- 15 actions atomiques.
- Conditions, requirements, fallback, cooldowns.
- Apparences conditionnelles (variantes par condition) + Layers (organisation top→bottom avec fall-through).
- Templates user-defined avec variables.
- Asset library avec uploads, imports MCModels (.zip), folders, tags, search.
- Resource pack generation (CMD strings 1.21.4+, polices custom, CDN hosting).
- **API d'intégration plugins tiers** (registerComponent single/paginable, placeholders, actions par défaut, layouts suggérés, palette dans l'éditeur, sync via WS, dégradation passive sur composants manquants).
- Authentification Discord OAuth.
- Multi-utilisateur (équipes) basique.
- Soft-lock multi-admin.
- Modèle freemium + 3 tiers Solo/Network/Unlimited.
- Anti-crack léger (signature au sync).
- Distribution multi-canal (SpigotMC, Modrinth, site, Stripe).
- Documentation API tierce (Javadoc + tutoriel + 1-2 reference implementations).

### 19.2 Explicitement hors scope MVP (V2+)

- **Variables natives** (player/server/session scopes). PlaceholderAPI suffit pour démarrer.
- **Auto-convert** depuis configs zMenu / DeluxeMenus. À évaluer selon la demande.
- **Marketplace native** de packs/menus. À envisager après validation d'une base d'utilisateurs significative ; entre temps, intégration MCModels.
- **Édition collaborative temps réel** à la Figma. Soft-lock suffit au MVP.
- **Environnement Staging** (preview gelée accessible aux testeurs invités). Reportée en V1.5 quand les workflows en équipe deviennent un use case réel ; en attendant, seul le draft personnel + le publish vers live sont supportés.
- **Export/Import de packs complets** (.itfz). En V1, seul l'export/import d'un menu seul est disponible. L'export/import de pack avec wizard find-&-replace pour les valeurs env-specific arrive en V1.5 (cohérent avec l'arrivée de l'importer MCModels).
- **Marketplace native de packs**. V3 (signature, pricing, reviews, discovery).
- **Refresh continu des apparences conditionnelles** (pour progress bars dynamiques temps réel).
- **Intégration native Nexo / ItemAdder** : reportée en **V1.5** (killer feature post-stabilisation MVP — voir section 13.11). Permettra le drag-and-drop direct des items et textures Nexo/ItemAdder dans l'éditeur.
- **Support Bedrock** (Geyser).
- **Mode framework HTML/CSS** ou systèmes de design avancés.
- **Actions économiques alternatives** (PlayerPoints, CoinsEngine, etc.). Vault couvre 80% au MVP.
- **Actions queues / BungeeCord / Velocity** (`send_to_server`). À ajouter dès que le besoin networks émerge.
- **Actions persistance / quêtes** (intégration Quests, BetonQuest). V2 selon les RPG servers.
- **Actions `play_particle` et `set_placeholder`**. Reportées.

---

## 20. Roadmap V2+ (indicative)

| Version | Features | Cible (post-launch) |
|---|---|---|
| V1.1 | Quality-of-life éditeur, fix bugs, optimisations perf, premières intégrations API par plugins partenaires | M+1 à M+3 |
| V1.5 | **Killer feature 1 : intégration native Nexo / ItemAdder** (items et textures drag-and-drop dans la palette, mode item + mode texture, dégradation gracieuse). **Killer feature 2 : assistant IA intégré** (bouton "Ask AI" qui prend du langage naturel et applique des mutations sur le JSON via Claude API ; se branche aussi sur le canvas V1 pour créer/lier des menus visuellement). Plus : environnement **Staging**, **export/import de packs complets** (.itfz) avec wizard find-&-replace, mode **slim** pour distribution plugin (cf. 12.12), importer MCModels en .itfz, `play_particle`, `set_placeholder`, actions économies alt. (PlayerPoints, etc.), API tierce enrichie (events, hooks, complex actions). Doc dev publique avec schéma JSON. | M+4 à M+6 |
| V2 | **Killer feature 1 : serveur MCP `interfaze-mcp`** (Claude Desktop / Cursor / autres clients MCP peuvent lister, lire, muter les menus depuis leur outil). **Killer feature 2 : plugins peuvent enregistrer des menus complets** (cf. section 13.13 — `registerMenuPack` API, namespace auto-dérivé, fork + redirections workspace-level). Plus : variables natives (player/server/session) + refresh continu apparences conditionnelles + actions Bungee/Velocity + édition multi-serveur synchronisée | M+6 à M+9 |
| V2.5 | Auto-convert zMenu/DeluxeMenus + intégration approfondie Nexo/ItemAdder (édition cross-plugin : créer un item Nexo depuis notre éditeur) + registry cloud des intégrations populaires | M+9 à M+12 |
| V3 | Marketplace native (assets + menus + intégrations tierces) + édition collaborative (Figma-like) + support Bedrock | M+12+ |

---

## 21. Risques et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Cracking massif du premium | Élevée | Moyen | Signature liée serveur ; communiquer "produit éthique" pour limiter les cracks ; itération rapide pour rendre le payant supérieur en valeur perçue |
| Adoption lente face à zMenu/DeluxeMenus établis | Moyenne | Élevé | Killer features : édition live + asset library + import MCModels ; vidéo showcase forte ; auto-convert en V2 |
| Coûts CDN qui explosent | Faible | Moyen | Quotas par tier ; cache agressif ; option self-host plugin pour les très gros |
| Conflit avec Nexo/ItemAdder en pratique | Faible | Élevé | 1.21.4+ et CMD strings éliminent le risque par design ; testbed dès le début avec Nexo installé |
| Discord ban d'un client clé | Faible | Élevé | Email recovery obligatoire ; procédure de support documentée |
| Subscription rejetée culturellement | Moyenne | Élevé | Communiquer "tu peux annuler quand tu veux, tes menus existants restent" ; pas de re-validation périodique ; témoignages |
| Surcharge éditeur (WS, génération packs) | Moyenne | Moyen | Workers de génération ; rate limiting ; queue Redis pour les jobs lourds |
| Couverture insuffisante des plugins économiques | Moyenne | Moyen | V1 = Vault uniquement (couvre la majorité) ; V1.5 = ajouts selon demande |

---

## 22. Glossaire

| Terme | Définition |
|---|---|
| **Bundle** | Artefact runtime : .zip signé (config + resource pack) téléchargé par le plugin depuis le CDN. Opaque pour l'admin, généré automatiquement par le backend. |
| **Pack** | Unité d'organisation dans le workspace (groupe de menus + commandes + templates + assets liés thématiquement). Aussi : format d'export/import partageable `.itfz` (cf. schéma `pack/v1`). |
| **Command** | Commande custom Interfaze, entité de premier ordre alongside les menus (cf. section 14). Schéma `command/v1`. Réutilise les actions et conditions du catalogue menu, plus un système d'arguments typés. |
| **Argument** | Paramètre positionnel typé d'une commande (`player`, `online_player`, `string`, `integer`, `number`, `boolean`, `world`, `enum` en V1). Tab-completion automatique selon le type. |
| **Contexte d'arguments** | Ensemble des valeurs résolues des arguments d'une commande, exposées comme placeholders `%args_<name>%` aux actions de la commande et propagées au menu ouvert. Coupable via `clear_context: true` sur `open_menu`. |
| **Workspace** | L'espace de travail d'un admin, contenant ses packs (Personal + user-created + imported + forked). |
| **Canvas** | Vue multi-menu de l'éditeur (V1), espace infini Figma-like où chaque menu est une carte preview, et les `open_menu` actions deviennent des flèches auto-dérivées. Toggle List/Canvas dans la toolbar. |
| **Slim pack** | Mode d'export d'un pack : manifest + JSONs only, assets référencés par URL CDN. ~10-100 KB. Conçu pour embarquage dans un JAR plugin. |
| **Full pack** | Mode d'export d'un pack : manifest + JSONs + assets binaires. Self-contained. Pour marketplace ou archive. |
| **Menu redirection (V2)** | Mapping workspace-level qui redirige les `openMenu(source_id)` vers un menu différent. Permet de remplacer un menu plugin par un fork sans casser les call sites. |
| **registerMenuPack (V2)** | API plugin tier qui permet à un plugin de fournir des menus complets au workspace de l'admin via un slim pack embarqué. Namespace auto-dérivé du plugin appelant. |
| **Server key** | Clé unique liant un serveur Minecraft à un compte éditeur |
| **Live** | Version d'un menu actuellement servie aux joueurs |
| **Draft** | Version en cours d'édition par un admin, visible uniquement par lui via `/menu preview <id>` |
| **Staging** *(V1.5)* | Version preview d'un menu, gelée et accessible aux testeurs invités avant publication. Hors scope MVP. |
| **Template** | Composant nommé réutilisable (façon Symbol Figma) |
| **Appearance** | Variante visuelle d'un Element. Évaluée dans l'ordre, première dont le `if` matche gagne. Si aucune ne matche → fall-through au layer en dessous. |
| **Layer** | Conteneur qui groupe des Elements dans un menu. Les layers sont ordonnés bottom→top, render top→bottom avec fall-through. |
| **CMD** | `custom_model_data`, mécanisme Minecraft pour assigner un modèle alternatif à un item |
| **CMD string** | Variante de CMD introduite en 1.21.4, utilisant un namespace string au lieu d'un int |
| **Pack stacking** | Capacité Minecraft (depuis 1.20.3) à empiler plusieurs resource packs sans conflit |
| **MiniMessage** | Format texte standard de Adventure / Paper. Tags XML-like (`<color>`, `<bold>`, `<gradient>`, `<click>`, `<hover>`...). Utilisé pour TOUS les champs texte des menus et commandes. Documentation : https://docs.advntr.dev/minimessage/format.html |
| **Clé i18n** | Identifiant slug hiérarchique (`menu.shop_main.btn_buy.title`) référencé via `{i18n:key}` dans n'importe quel champ texte. Scoped au workspace de l'admin. Schéma `translations/v1`. |
| **Translation** | Valeur d'une clé i18n pour une langue donnée. Format MiniMessage. Peut contenir des placeholders PAPI et d'autres références i18n. |
| **default_lang** | Langue de référence du workspace, garantie pour toute clé i18n. Fallback ultime si une autre langue manque à l'exécution. |
| **Schéma JSON** | Format intermédiaire versionné (`menu/v1`, `menu/v2`...) publié comme asset produit avec types TypeScript et JSON Schema |
| **MCP server** | Serveur Model Context Protocol (`interfaze-mcp`) qui expose les opérations sur les menus aux clients IA (Claude Desktop, Cursor, etc.). Roadmap V2 |
| **PluginIntegration** | Enregistrement d'un plugin tiers auprès de l'éditeur (palette de composants + layouts suggérés) |
| **Component** | Composant fourni par un plugin tiers (bouton single ou paginable, avec placeholders et action par défaut) |
| **Composant paginable** | Composant qui occupe une rangée de slots et génère N instances dynamiquement |
| **Layout suggéré** | Menu pré-rempli proposé par un plugin tiers comme point de départ (purement indicatif) |
| **component_ref** | Référence dans le JSON d'un menu vers un composant tiers (ex. `questx:quest_button`) |

---

## 23. Prochaines étapes

1. **Valider cette spec** avec l'équipe / les early users / les YouTubers ciblés.
2. **Calibrer les prix** des tiers (Solo / Network / Unlimited) via une mini-survey ou benchmark.
3. **Prototype d'éditeur** (1-2 semaines) pour valider l'UX drag & drop + édition live.
4. **POC plugin** (1 semaine) pour valider la pipeline resource pack 1.21.4+ avec Nexo installé en parallèle.
5. **Ouverture d'une closed beta** (50-100 admins triagés) pour le run-in avant launch public.
