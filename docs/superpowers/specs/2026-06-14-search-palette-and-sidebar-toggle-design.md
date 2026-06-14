# Palette de recherche Cmd+K + sidebar toggleable — Design

> Spec brainstormée le 2026-06-14. Fait suite à [`2026-06-13-workspace-board-curation-design.md`](./2026-06-13-workspace-board-curation-design.md) : le `WorkspacePanel` (panneau d'éléments) y a été introduit avec une recherche inline. Cette spec déplace la recherche vers une **palette de commande globale (type GitBook)** et rend le panneau **toggleable**.

**Statut** — Spec validée en brainstorming, à transformer en plan d'implémentation.

> ⚠️ **Dépendance de branche** — au moment du brainstorm, des correctifs UX du panneau vivent sur la branche `fix/workspace-board-polish` (non mergée) et touchent `WorkspacePanel.tsx`, `uiStore.ts`, la route overview et les locales — les **mêmes fichiers** que cette feature. **Merger `fix/workspace-board-polish` dans `main` avant** d'implémenter cette spec, sinon divergence/conflits.

---

## 1. Problème

Le `WorkspacePanel` (gauche) reste ouvert en permanence et porte un champ de recherche inline qui ne filtre que la **liste des éléments par leur label** (noms/titres). Deux limites :

1. Le panneau occupe de la place en permanence ; l'utilisateur veut pouvoir le **masquer**.
2. La recherche est **superficielle** (labels seulement) et **enfouie** dans le panneau. L'utilisateur veut une recherche **rapide (raccourci clavier), globale (topbar), multi-niveaux** — capable de trouver non seulement les menus/commandes/dialogs mais aussi **leur contenu** (items posés, titres, lore, corps de dialogue).

## 2. Direction validée

Séparer **trouver** de **organiser**, façon GitBook :

- **Palette de recherche** (`SearchPalette`) — overlay flottant éphémère, ouvert au **Cmd/Ctrl+K** ou via un **bouton 🔍 dans la topbar**. Cherche tout (éléments + contenu), navigable aux flèches, fermable via Esc. Sélectionner un résultat ouvre la **vue individuelle** de l'élément (et sélectionne le sous-élément si le match est un slot/texte).
- **Sidebar (`WorkspacePanel`) toggleable** — garde son rôle d'**organisation** (liste catégorisée, badges on-board, drag-to-board, création, menu contextuel). On **retire son champ de recherche inline** : la palette est désormais la seule recherche (« pierre deux coups »).

**Principe** : la palette *trouve* (rapide, profond, éphémère) ; la sidebar *parcourt/organise* (drag, création). Pas de redondance — un seul moteur de recherche.

## 3. Sidebar toggleable (`WorkspacePanel`)

### 3.1 Toggle non-ambigu
Il y a **deux** panneaux à gauche en desktop : l'**app nav** (`WorkspaceSidebar` : marque, workspaces, modules, compte — toujours visible en desktop) et l'**elements panel** (`WorkspacePanel`). Pour qu'on sache que le toggle contrôle le panneau d'éléments (et pas l'app nav) :

- Un **bouton dédié dans la topbar workspace**, à gauche (aligné au-dessus du panneau), avec :
  - une **icône qui représente un panneau latéral** (`PanelLeft` / état ouvert vs fermé via `PanelLeftClose`/`PanelLeftOpen`) — **pas** un hamburger générique (qui évoquerait l'app nav) ;
  - le **label « Éléments »** à côté de l'icône.
- L'icône **reflète l'état** (ouvert/fermé) pour feedback immédiat.

### 3.2 État & persistance
- Nouveau flag `uiStore.workspacePanelOpen: boolean` (+ `setWorkspacePanelOpen` / toggle), **persisté** (le `uiStore` est déjà `persist`).
- **Défaut** : ouvert au premier chargement, puis **mémorise le choix** (si l'utilisateur le ferme, il reste fermé aux sessions suivantes).
- **Desktop** : la colonne 240px du panneau n'est rendue que si `workspacePanelOpen` ; sinon board + éditeur récupèrent l'espace.
- **Mobile** : inchangé — le panneau est déjà un `Sheet` drawer (cf. board-curation §9) ; le bouton « Éléments » de la topbar en est le déclencheur.

### 3.3 Retrait de la recherche inline
Supprimer le `<Input>` de recherche en haut de `WorkspacePanel` et l'état `q`/filtrage associé. Le panneau liste désormais tous les éléments (groupés), sans filtre local. (La palette couvre la recherche.)

## 4. Palette de recherche (`SearchPalette`)

### 4.1 UI
- Overlay centré (réutiliser le `Dialog`/`DialogContent` du design system, ou un conteneur dédié type command-palette), largeur ~560px, ancré haut-centre.
- En haut : un `<input>` de recherche (autofocus). En dessous : la liste de résultats, **groupés par type** (Menus / Commandes / Dialogs / Contenu).
- Chaque résultat : icône de type + **label** + **contexte** du match. Exemples :
  - `hub` — menu
  - `/heal` — commande
  - `confirm_delete` — dialog
  - `DIAMOND — dans shop` (item dans un menu)
  - `« Bienvenue » — titre de hub` (texte)
  - `« Clique pour acheter » — lore, shop` (texte d'item)

### 4.2 Ouverture / fermeture
- **Cmd/Ctrl+K** (global, quand un workspace est ouvert) ouvre la palette — **y compris depuis un champ de saisie** (`preventDefault` ; c'est un raccourci global standard). No-op si la palette est déjà ouverte.
- Un **bouton 🔍 « Rechercher » dans la topbar** (avec hint `⌘K`) l'ouvre aussi (découvrabilité).
- **Esc** ferme ; clic hors palette ferme.
- État : `uiStore.searchOpen: boolean` (+ setter). Non persisté (transitoire, comme `assistantPanelOpen`).

### 4.3 Navigation clavier
- **↑ / ↓** déplacent la sélection à travers la liste aplatie de résultats (en sautant les en-têtes de groupe).
- **Entrée** active le résultat sélectionné.
- Survol souris met aussi en surbrillance ; clic active.

### 4.4 Action de sélection
À l'activation d'un résultat :
- **Élément (menu/commande/dialog)** → `navigate` vers la vue individuelle `…/element/$elementId`.
- **Item / texte à l'intérieur d'un menu** → `navigate` vers la vue individuelle du **menu propriétaire**, puis sélectionner le **slot/élément** concerné (`selectionStore.set([elementId], slot?)`) pour que l'éditeur le focalise.
- **Texte de dialog (corps/bouton)** → vue individuelle du dialog propriétaire (pas de sous-sélection fine en V1 ; le flux dialog est centré).
- Fermer la palette après activation.

## 5. Index de recherche (`searchIndex.ts`, pur)

`buildSearchIndex(pack, activeLang): SearchEntry[]` — produit une liste **plate** d'entrées indexables. Types d'entrées :

```ts
type SearchEntry =
  | { kind: "menu"; id: MenuId; label: string }
  | { kind: "command"; id: CommandId; label: string }   // label = `/${name}`
  | { kind: "dialog"; id: DialogId; label: string }
  | { kind: "item"; ownerMenuId: MenuId; elementId: ElementId; slot: number; material: string; label: string }
  | { kind: "text"; ownerType: "menu" | "dialog"; ownerId: string; elementId?: ElementId; field: "menuTitle" | "itemTitle" | "itemLore" | "dialogBody" | "dialogButton"; text: string };
```

**Périmètre indexé** (décidé en brainstorm) :
- **Noms & titres** des menus (titre résolu), commandes (`/name`), dialogs (id/titre).
- **Items des menus** : matériau (DIAMOND…), custom item / head, par slot/élément.
- **Textes i18n** (langue active) : titres + lore des items, corps + labels de boutons des dialogs, titres de menus.

**Hors périmètre V1** : triggers/alias/permissions des commandes, cibles d'actions (« ouvre menu X »). *(Reporté — les edges/chips du canvas couvrent déjà la visibilité des liens.)*

`searchQuery(entries, q): RankedResult[]` — match **substring insensible à la casse**. Classement simple :
1. match exact > préfixe > sous-chaîne ;
2. niveau élément (menu/commande/dialog) > niveau contenu (item/texte) à score égal.
Mémoïsé par `(pack, activeLang)` ; recomputé sur la requête. Packs petits → coût négligeable, pas de persistance/worker.

## 6. Fichiers

**Créés**
- `editor/src/features/search/searchIndex.ts` — `buildSearchIndex` + `searchQuery` (purs).
- `editor/src/features/search/SearchPalette.tsx` — overlay UI + navigation clavier + action de sélection.
- `editor/src/features/search/useGlobalSearchShortcut.ts` *(ou inline dans la route)* — listener Cmd/Ctrl+K → `setSearchOpen(true)`.

**Modifiés**
- `editor/src/features/workspace/WorkspacePanel.tsx` — retirer l'`<Input>` de recherche + l'état `q`.
- `editor/src/routes/networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` — bouton toggle « Éléments » (topbar) + bouton 🔍 « Rechercher » ; rendu conditionnel de la colonne panneau selon `workspacePanelOpen` ; montage de `<SearchPalette>` ; câblage Cmd+K.
- `editor/src/components/WorkspaceTopBarControls.tsx` *(si la topbar y vit)* — héberger les deux boutons (toggle + recherche). À vérifier : où vivent les contrôles topbar.
- `editor/src/state/uiStore.ts` — `workspacePanelOpen` (persisté) + `searchOpen` (transitoire) + setters.
- `editor/src/locales/en.ts` + `fr.ts` — clés : `search.placeholder`, `search.open` (« Rechercher »), `workspacePanel.toggle` (« Éléments »), en-têtes de groupes, libellés de contexte.

## 7. Tests

- **`searchIndex`** (unit) : construit des entrées pour noms/items/textes ; `searchQuery` matche et classe correctement ; un match de contenu (item/texte) référence le bon propriétaire (`ownerMenuId`/`elementId`).
- **`SearchPalette`** : taper filtre les résultats ; ↑/↓ déplacent la sélection (sautent les en-têtes) ; Entrée navigue (et sous-sélectionne pour un item) ; Esc ferme. Mocker `useNavigate` + `selectionStore`.
- **Toggle sidebar** : le bouton « Éléments » bascule `uiStore.workspacePanelOpen` ; masqué → la colonne panneau n'est pas rendue. Mettre à jour le test existant de `WorkspacePanel` qui vérifiait le filtrage par recherche inline (la recherche a déménagé).
- **Cmd+K** : le raccourci ouvre la palette même depuis un input (preventDefault) ; no-op si déjà ouverte.

## 8. Non-goals

- Recherche **logique/liens** (triggers, alias, permissions, cibles d'actions) — V2.
- Recherche **cross-pack / cross-workspace** — périmètre = pack courant.
- Indexation persistante / worker — inutile vu la taille des packs.
- Actions dans la palette autres que « ouvrir » (pas de create/delete/add-to-board depuis la palette en V1 — ça reste dans la sidebar/canvas).
