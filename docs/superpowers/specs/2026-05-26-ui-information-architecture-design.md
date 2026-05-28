# UI Information Architecture Design

> Spec brainstormée le 2026-05-26 pour cadrer la navigation principale d'Artisan à l'arrivée des modules. Source de vérité pour le plan d'implémentation correspondant.

**Goal** — Remplacer la sidebar placeholders (`Menus` + `Commandes` qui pointaient tous deux sur `/networks`, héritage de la migration modular monolith) par une vraie information architecture qui scale jusqu'à l'arrivée des modules tiers (Shop V1.5, Quests V2…). Au passage, renommer "Pack" pour éviter la confusion avec "resource pack" et fixer la structure d'une page Module qui sera utilisée en V1.5+.

**Statut** — Spec validée. Implémentation V1 = sidebar restructure + renommage. Module hub UI documenté mais implémenté en V1.5 quand shop arrive.

---

## 1. Vocabulaire

| Avant | Après | Pourquoi |
|---|---|---|
| Pack | **Workspace** | "Pack" évoque resource/datapack en contexte Minecraft. "Workspace" est neutre et industrie-standard. |
| Canvas (du Module hub) | **Overview** | Vue par défaut d'une page (Workspace ou Module), pas une référence à l'implémentation Konva. |

Le mot "Workspace" est utilisé identique en EN et en FR (le marché anglophone est plus large, et "Espace" en FR est moins clair).

**Périmètre du rename** :
- ✅ Labels UI partout
- ✅ Route `/pack/$packId` → `/workspace/$workspaceId`
- ❌ Type DB `packs` (table), colonnes `pack_id`, `packs.id` — pas touchés (refactor non rentable)
- ❌ Protocole WS — `pack_id`, `pack_hashes`, `bundle_available.pack_id` (changer = breaking, hors scope)
- ❌ REST API — `/api/v1/user/packs/*`, `/api/v1/networks/:id/packs/*` (versionnée, breaking = besoin de v2)

Conséquence : "Pack" reste un terme interne (DB, protocole, API) mais disparaît côté utilisateur. C'est OK — les admins ne voient jamais le DB schema.

## 2. Sidebar (toujours visible)

Composition de haut en bas :

```
┌─────────────────────────────┐
│ [Mon Network ▼]             │  ← Network dropdown
├─────────────────────────────┤
│ MES WORKSPACES              │
│  📋 Menu principal          │  ← workspaces du network courant
│  🏠 Lobby                   │
│  ⭐ Grades                  │
│  + Nouveau workspace        │
│                             │
│ MODULES INSTALLÉS           │
│  ┌─────────────────────┐    │
│  │ Aucun module        │    │  ← V1 : empty state
│  │ installé. Shop,     │    │
│  │ Quests… arrivent.   │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

### 2.1 Network dropdown

- Affiche le name du Network actif.
- Click → dropdown listant tous les Networks de l'user (membership). Click sur un autre Network = switch.
- Une entrée "Gérer les networks" en bas du dropdown → page `/networks` (liste + settings, current behavior).
- État vide : si l'user n'a aucun Network (cas après /artisan setup sans flow complet), redirect direct vers `/networks` ou `/setup`.

### 2.2 Section "MES WORKSPACES"

- Liste les workspaces du Network actif, ordonnée par updated_at desc (most-recently-edited first).
- Click sur un workspace → navigate `/workspace/$workspaceId`.
- "+ Nouveau workspace" → modal de création (name + description, comme aujourd'hui).
- Visible **toujours**, même si la liste est vide (avec un bouton + au milieu plus visible).

### 2.3 Section "MODULES INSTALLÉS"

- **V1** : empty state factuel. Texte :
  > Aucun module installé. Les plugins compatibles Artisan (Shop, Quests, etc.) apparaîtront ici quand tu les ajouteras à ton serveur.

  Pas de promo, pas de "coming soon", pas de lien Discord — signal neutre que cet espace existe et se remplira.

- **V1.5+** (hors scope implémentation V1, documenté ici pour le plan futur) :
  - Liste les modules installés agrégés depuis les server_keys du Network actif.
  - Source de vérité : `hello.installed_modules: [{id, version}, …]` qu'envoie chaque plugin (déjà spécifié dans `versioning.md` §4.1). Backend stocke par server_key, dérive l'union pour un Network.
  - Si deux server_keys d'un même Network ont des versions de module différentes (cas rare), prendre la version la plus haute et logger un warning UI.
  - Click sur un module → navigate `/module/$moduleId` (route à part — module n'est pas un workspace).

## 3. Page Workspace `/workspace/$workspaceId`

**Comportement V1** : identique à `/pack/$packId` actuel, juste le path renommé et les labels UI mis à jour.

Pas d'onglets en haut. Le canvas Konva occupe la majeure partie de l'écran, avec la PackMiniSidebar à gauche pour naviguer entre menus du workspace, et les panels (Library, Translations, DataSources, History, BranchSwitcher) accessibles via les boutons existants.

Une seule modif visible côté UI : tout label "Pack" devient "Workspace".

## 4. Page Module `/module/$moduleId` (V1.5+, spec uniquement)

**Hors scope d'implémentation V1.** Documenté ici parce que la structure dicte la forme du `FrontendModule` interface qu'on a déjà posée dans la migration modular monolith.

### 4.1 Shell : onglets en haut

```
┌──────────────────────────────────────────────────┐
│ 🛒 Shop v1.0 · main branch                       │
├──────────────────────────────────────────────────┤
│ [Overview] [Data] [Categories]                   │  ← tabs
├──────────────────────────────────────────────────┤
│                                                  │
│  (contenu de l'onglet actif)                     │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 4.2 Onglets

- **Overview** (toujours présent, le premier) : le canvas. Pré-rempli avec les menus / commands / dialogs que le plugin a seedés au bootstrap du module. Éditable comme un workspace normal.
- **Onglets suivants** : déclarés par le plugin via son `FrontendModule`. Chaque onglet = nom + composant React + (optionnel) JSON Schema rendu via `<SchemaForm>`.

Exemple pour Shop V1.5 :
```ts
const shopModule: FrontendModule = {
  id: "shop",
  displayName: "Shop",
  schemaVersion: "shop/v1",
  sidebar: { icon: ShopIcon, label: "Shop", to: "/module/shop" },
  tabs: [
    // Overview is implicit, added by the shell
    { id: "data", label: "Data", schema: shopItemListSchema },
    { id: "categories", label: "Categories", schema: shopCategoriesSchema },
  ],
  routes: [],
};
```

### 4.3 Discovery côté plugin

Comment l'éditeur sait qu'un module Shop existe ?
1. Le plugin Java `ArtisanShop.jar` est installé sur un MC server.
2. Au hello WS, il envoie `installed_modules: [{id: "shop", version: "1.0.0"}, …]`.
3. Backend persiste par server_key (table `server_modules`, à créer en V1.5).
4. Éditeur fetch les modules d'un Network = union des modules de ses server_keys.
5. Pour render la page Module, l'éditeur a besoin du `FrontendModule` côté JS. Deux options à explorer en V1.5 :
   - (a) Bundler les `FrontendModule` JS dans l'app éditeur (registry statique). Marche pour les modules officiels Artisan.
   - (b) Charger dynamiquement depuis un CDN ou depuis l'endpoint backend. Nécessaire pour modules tiers V3+.

V1.5 ship probablement avec (a). (b) attendre V3+.

## 5. Suppression V1

À retirer de la sidebar actuelle :
- Entrée "Menus" pointant vers `/networks`
- Entrée "Commandes" pointant vers `/networks`

Ces entrées venaient de la migration modular monolith où on avait posé les `FrontendModule` `menus` et `commands` comme placeholders. La nouvelle sidebar prend leur place.

Les `FrontendModule` `menus` et `commands` peuvent rester dans le code éditeur (`editor/src/modules/{menus,commands}/index.ts`) — ils gardent leur utilité conceptuelle dans le registry. On les retire juste du rendu sidebar.

## 6. V1 scope d'implémentation

Ce qui est implémenté maintenant :

| Item | Détail |
|---|---|
| Composant `WorkspaceSidebar` | Remplace `ModuleSidebar` actuel. Network dropdown + section Workspaces + section Modules (empty state). |
| Network dropdown component | Lit `useAuthStore` + `useNetworksStore`, gère le switching. |
| Workspaces section | Fetch via `listNetworkPacks(networkId)` (route backend existante). |
| Modules section empty state | Texte fixé (pas d'API call en V1). |
| Route rename | `editor/src/routes/pack.$packId.tsx` → `workspace.$workspaceId.tsx`. Le route `/pack/:id` reste mounted comme stub qui appelle `useNavigate({ to: "/workspace/$id", replace: true })` au mount, pour préserver les bookmarks et liens externes. |
| UI label rename | Tous les `Pack` user-facing → `Workspace`. Inclut breadcrumbs, modals, error messages, toasts. |
| Sidebar deletion | Retirer rendu de `menus` et `commands` modules (le registry les garde, juste pas affichés). |

Ce qui n'est PAS implémenté en V1 (différé V1.5) :
- Page `/module/$moduleId` et son shell tabs
- Détection `installed_modules` depuis WS hello (côté backend storage + côté éditeur fetch)
- `FrontendModule.tabs[]` extension du type (interface)
- Wiring `<SchemaForm>` aux tabs Data

## 7. Edge cases V1

- **User sans Network** : redirect vers `/setup` (existing behavior preserved).
- **User avec un seul Network** : dropdown affiche le nom mais ne montre pas le menu de switching (juste un caret discret, pas de spam).
- **Switching Network avec workspace ouvert** : navigate to `/networks/$newNetworkId` (page d'accueil du new network), pas vers un workspace au hasard. L'user voit la nouvelle liste de workspaces.
- **Deeplink legacy `/pack/abc123`** : le route `/pack/$packId` reste mounted mais `useNavigate({ to: "/workspace/$packId", replace: true })` au mount (client-side redirect, préserve les bookmarks et liens externes).

## 8. Non-décisions reportées

Pas tranché ici (à creuser quand le besoin émerge) :
- **Module = par network ou par server_key ?** En V1.5+, si un Network a 3 server_keys et seul un d'entre eux a Shop installé, est-ce que Shop apparaît dans la sidebar du Network ? Probable oui (l'admin gère Shop pour ce server depuis l'éditeur). Mais à valider quand on implémente.
- **Tabs ordre / pin** : V1.5+ — l'utilisateur peut-il réordonner les onglets d'un Module ? V1.5 = non, ordre dicté par le plugin. À revisiter avec feedback.
- **Workspace pinning** : l'utilisateur peut-il épingler ses workspaces favoris en haut de la liste ? V1 = non, sort par updated_at. À revisiter avec feedback.

---

## Annexe : décisions de l'utilisateur capturées

1. **Q : Pack = Module ou Pack ≠ Module ?** → **B (Workspaces vs Modules séparés)**
2. **Q : Comment renommer Pack ?** → **Workspace** (EN + FR)
3. **Q : Layout interne ?** → **Workspace = canvas seul. Module = canvas + tabs**
4. **Q : Comment renommer Canvas ?** → **Overview**
5. **Q : Hiérarchie Network dans sidebar ?** → **B (Network dropdown en haut)**
6. **Q : Modules section V1 ?** → **Empty state factuel**
7. **Q : Renommer aussi le route path ?** → **Oui**
