# Carte visuelle de l'éditeur Artisan

Description exhaustive de chaque écran de l'éditeur web — sidebars, panels, boutons, et leur position. Source : lecture des routes et composants `editor/src/` au 2026-05-28.

> **Note de pile** : React 19 + Vite 6 + TanStack Router + Zustand + shadcn/ui (Radix) + Konva pour le canvas.

---

## 1. Shell global (`__root.tsx`)

**Layout** : flex container horizontal pleine hauteur.

| Région | Position | Largeur | Visibilité |
|---|---|---|---|
| `ProjectSidebar` | Gauche, sticky | 192 px (`w-48`) | Uniquement si authentifié |
| `<Outlet />` (route active) | Droite, `flex-1` | reste | Toujours |

Bordure droite zinc-800, fond zinc-950 sur la sidebar.

---

## 2. Pages d'authentification

### `/login` & `/signup`

Layout identique : `min-h-screen flex items-center justify-center p-8`, conteneur centré `max-w-sm`.

**Form de login** (haut → bas) :
1. Titre "Connexion" (`text-xl font-semibold`)
2. Input email (`type=email`, required)
3. Input password (`type=password`, required, `minLength=8`)
4. Message d'erreur (rouge, conditionnel)
5. Bouton submit "Se connecter" (`bg-black text-white px-4 py-2`)
6. `DiscordLoginButton` (OAuth)
7. Lien vers `/signup`

**Form de signup** : ajoute un input `name` (required) entre email et password ; le reste identique avec un lien vers `/login`.

---

## 3. Pages compte / réseau

### `/account`

Colonne unique `max-w-2xl mx-auto p-8`, gap-6.

1. **Header**
   - Titre "Compte"
   - Sous-titre "Connecté en tant que `{name}` (`{email}`)"
2. **Section Networks**
   - Heading uppercase tracking-wider
   - Si aucun network : bouton "Créer un Network" → `/setup`
   - Sinon : grille de cards (`block p-2 border rounded hover:bg-muted`) liant vers `/networks/$networkId`
   - Lien "+ Ajouter un serveur" en bas de section
3. **`LogoutButton`** en fin de page

### `/networks` (liste)

Colonne unique `min-h-screen p-8`. Titre "Mes Networks" (`text-2xl`).

- **État vide** : phrase "Aucun Network" + code snippet `\artisan setup` + lien `/setup`
- **État rempli** : `grid gap-3`, chaque card `p-4 border border-zinc-700 rounded` affiche le nom (font-medium) et le tier (text-xs muted)
- Lien "+ Ajouter un serveur" sous la liste

### `/networks/$networkId` (détail)

Colonne `max-w-3xl mx-auto p-8`, gap-8.

**Header** : nom du network (`text-2xl`) à gauche, lien "Settings" en `text-sm text-zinc-400` à droite.

Trois sections (heading uppercase tracking-wider chacune) :

1. **Projects**
   - Vide → "Aucun project"
   - Rempli → liste verticale de cards (`p-3 border rounded`) qui ouvrent `networks.$networkId.servers.$serverId.projects.$projectId`
2. **Server Keys**
   - Vide → "Aucune server_key"
   - Rempli → liste de cards `flex justify-between` avec `id` en font-mono à gauche et bouton "Supprimer" rouge à droite
3. **Members** → placeholder "Invitations à venir"

### `/networks/$networkId/settings`

Colonne `max-w-2xl mx-auto p-8`, grid gap-8. Titre "Settings".

**Section "Transférer la propriété"** :
- Heading `text-lg`
- Description `text-sm text-zinc-400`
- Bouton "Générer un lien de transfert" (`bg-zinc-700`)
- Si lien généré : input read-only en font-mono avec le token + label d'expiration

---

## 4. Settings globaux (`/settings`)

Split horizontal `flex h-full` :

| Pane | Largeur | Contenu |
|---|---|---|
| **Nav gauche** | 224 px (`w-56`) | Bordure droite, padding 3. Section unique active "Appearance" (bouton `bg-zinc-800 px-3 py-2 text-left text-sm`) |
| **Contenu droit** | `flex-1 overflow-auto p-6` | `AppearanceSection` (héberge entre autres l'`EditorLangSwitcher` — langue de l'UI elle-même, pas du project) |

---

## 5. Setup wizard (`/setup`)

`min-h-screen flex items-center justify-center p-8`, card centrée `max-w-lg flex flex-col gap-6`.

Header : indicateur d'étape (`text-xs text-muted-foreground` aligné à droite).

**4 étapes en séquence** :

1. **Step 1 — Network** : liste des networks existants (boutons p-3 border rounded ; sélectionné = `border-primary bg-muted`) + champ "Nouveau network" avec bouton "Créer" en dessous
2. **Step 2 — Project** : même structure que step 1 mais pour les projects
3. **Step 3 — Server Key** : bouton "Générer une clé serveur" → la clé apparaît dans un code-block `bg-muted px-3 py-2 font-mono break-all` avec la mention "copie-la maintenant — affichée une seule fois"
4. **Step 4 — Installation** : trois blocs `<pre>` avec instructions de config, la server_key, et la commande de reload

**Footer** des 4 étapes : bouton "Retour" (variant=outline, désactivé sur step 1) + bouton "Suivant" / "Terminer" (désactivé selon validation).

---

## 6. Flux link / session / transfer

### `/link` (claim d'un network depuis le plugin)

`min-h-screen p-8`. 5 états :

| État | Contenu |
|---|---|
| Loading | "Chargement…" |
| Invalid / Already used / Expired / Error | Titre `text-2xl`, message d'erreur, instructions de récupération |
| Done | "Setup terminé ! Retourne sur ton serveur Minecraft" |
| Ready (multi-network) | Heading "Choisis le Network destination", `grid gap-2` de boutons (chacun `p-3 border`, checkmark sur sélection), bouton "Confirmer" (`bg-blue-600`) |
| Ready (single network) | Heading "Lier ce serveur", texte de confirmation, bouton "Confirmer" |

### `/session` (redirect historique — accounts-only)

Le mode session éditeur (trust dance `/artisan editor`) a été supprimé (accounts-only cutover). `/session` est désormais une simple page de redirection : elle affiche un toast (`sessionGone.message`) puis redirige vers `/login`. Sert uniquement à ne pas 404 les vieux liens `?token=...`.

### `/transfer`

`max-w-md mx-auto p-8`. Variantes : Loading, Error, Expired, Consumed, Not found, Ready-to-accept, Accepted.

**Ready-to-accept** :
- Titre "Transférer la propriété" (`text-2xl`)
- Phrase "Tu vas devenir owner de `{networkName}`"
- Métadonnées `{projectCount} projects · {serverKeyCount} server_keys` (text-sm zinc-400)
- Bouton "Accepter" (`bg-blue-600`)

**Accepted** : message + redirection auto vers `/networks/$networkId`.

---

## 7. Project — l'écran principal d'édition

Route : `networks.$networkId.servers.$serverId.projects.$projectId`. Layout vertical (top bar → tabs → contenu).

### 7.1 Top bar (hauteur fixe 48 px / `h-12`)

Fond zinc-950, bordure basse zinc-800, `flex items-center gap-2 px-2`.

De gauche à droite :

| Élément | Détails |
|---|---|
| **Nom du project** | `flex-1 truncate font-mono text-sm text-zinc-200` |
| **`LangSwitcher`** | Bouton h-9 text-xs font-mono avec le code langue + caret ▾ — change la langue du **contenu du project** (pas l'UI) |
| **Undo / Redo** | Deux `TopBarIconButton` (`h-9 w-9`), icônes `Undo2` / `Redo2` (lucide-react), désactivés si rien à défaire |
| **Revert** | Bouton h-8 text-xs zinc-400, label "Annuler" |
| **Deploy** | Bouton h-8 emerald-700, label "Déployer" / "Déploiement…" |
| **`TopBarKebabMenu` ⋮** | Icône MoreVertical h-8 w-8 — ouvre un menu avec : Export ZIP / Import / Export / Patterns / ─── / Delete (rouge) |

### 7.2 Tab strip (sous le top bar, si project chargé)

`role=tablist border-b border-zinc-800 px-2`. 3 onglets :

| Onglet | Active state | Badge éventuel |
|---|---|---|
| **Overview** (défaut) | `border-b-2 border-blue-500` | — |
| **Translations** | idem | Pastille ambre avec le nombre de traductions manquantes |
| **Data-Sources** | idem | — |

Inactifs : `border-transparent text-zinc-400`.

### 7.3 Barre de branche (conditionnelle si `networkId` résolu)

Section `border-b border-zinc-800 p-3 flex flex-col gap-2` au-dessus du contenu :
- Row 1 : `BranchSwitcher` + bouton "Commit" + bouton "Promote" + bouton "Merge"
- Row 2 : `HistoryPanel` (liste des commits récents de la branche)

### 7.4 Contenu de l'onglet Overview

`SplitPane` redimensionnable (drag de la barre du milieu) :

**Desktop (≥ lg)** — horizontal :
- **Stage** (gauche, min 400 px) : canvas Konva (voir §8)
- **EditorPane** (droite, ~280 px, min 280) : onglets Edit / Library / Assets (voir §9)

**Mobile (< lg)** — vertical :
- **Stage** (haut, min 200 px)
- **EditorPane** (bas, ~120 px, min 120)

### 7.5 Floating overlays (sur le project)

- **`PatternsGallery`** : side sheet (Radix Sheet) déclenché depuis le kebab
- **Dialog d'erreurs d'export** : modal avec liste de validation errors
- **`DeleteProjectDialog`** : confirmation rouge (voir §11)
- **`LibraryDragOverlay`** : ghost flottant qui suit le curseur pendant un drag depuis la Library
- **Draft notice banner** : `fixed top-4 right-4 z-50`, fond amber, auto-dismiss 5 s

### 7.6 Contenu de l'onglet Translations

Voir §10.

### 7.7 Contenu de l'onglet Data-Sources

Voir §10 (suite).

---

## 8. Le Stage (canvas Konva)

Conteneur observe sa taille via `ResizeObserver`. À l'intérieur : un `<Stage>` react-konva sur lequel sont rendus :

- **MenuGroup** — un groupe Konva par menu (background, slots, layers de titre, items)
- **CommandGroup** — visualisation des commands liées
- **DialogGroup** — visualisation des dialogs liés
- **Edges** — `Konva.Line` entre entités liées (clic → ouvre menu cible)
- **Selection** — outline/glow de l'item sélectionné
- **ContextMenu** — menu DOM superposé (clic droit / long press tactile)
- **EdgeTooltip / ItemTooltip** — tooltips au hover

**Interactions natives** :
- Clic → place le matériau armé OU sélectionne
- Clic droit / long press → context menu
- Molette → pan/zoom
- Touch → pan
- Drag d'un layer de titre → repositionne (avec `ResizeHandles` aux coins pour redimensionner)

**Overlays DOM au-dessus du canvas** :
- `TextEditor` (édition inline d'un layer texte sélectionné)
- `ArmedBanner` (apparaît en haut quand un matériau est armé pour placement)

---

## 9. EditorPane (sidebar droite, 3 onglets)

`<Tabs>` plein-hauteur. TabsList en haut, hauteur 36 px, `flex items-center gap-5 border-b border-zinc-800 px-3`. Indicateur d'onglet actif = soulignement emerald-500.

### 9.1 Onglet **Edit** → `FlowCanvas`

Éditeur de propriétés unifié qui route selon la sélection actuelle :

| Sélection | Composant rendu |
|---|---|
| Project | `ProjectProperties` |
| Menu | `MenuProperties` |
| Element | `ElementEditor` (layout custom — voir ci-dessous) |
| Command | `CommandEditor` |
| Dialog | `DialogEditor` |

#### `ElementEditor` (le plus riche)

`flex h-full flex-col bg-zinc-950` :

1. **Strip d'identité** (top, `border-b bg-zinc-900 px-3 py-2`)
   - Thumbnail matériau 8×8 px
   - Titre `font-mono text-xs`
   - Sous-titre `text-[10px] text-zinc-500` : nom du menu + nombre d'états
2. **Body** (`flex-1 overflow-auto px-3 py-3`)
   - `ElementIdField`
   - `PositionsField`
   - `IterationField`
   - **SortableStates** (Lane) — cards d'états (chaque card affiche thumbnail / titre / count / lore / conditions ; drag pour réordonner)
   - **ClickHandlers** (Lane) — blocs d'actions par type de clic (left, right, shift, ctrl…)

### 9.2 Onglet **Library** (Library d'items)

Sélecteur de matériau Minecraft / custom items.

1. **Barre filtres** (haut)
   - Input "Search…"
   - Chips de catégorie (border-rounded-full, actif = `border-emerald-600 bg-emerald-600/10 text-emerald-300`)
2. **Grille virtualisée** (`@tanstack/react-virtual`)
   - Tiles 48×48 px, gap 6 px
   - Chaque `ItemTile` : `rounded border border-zinc-600`, hover emerald si armé
   - Image lazy (icône PNG pré-rendue server-side) ou placeholder lettre de catégorie
   - `cursor-grab` (drag vers le canvas) + clic → arme le matériau pour placement

### 9.3 Onglet **Assets**

Voir §10 ci-dessous.

---

## 10. Panneaux de contenu (Translations, Data-Sources, Assets)

### 10.1 `TranslationPanelContent`

Pleine largeur quand activé depuis le tab strip. Vertical :

1. **Header** (`border-b px-4 py-3`)
   - Titre "Translations" (font-mono text-sm)
   - Stats "{N} translated / {total} total"
   - Pastille missing (ambre) ou checkmark (emerald)
2. **Tabs de langues** (`border-b bg-zinc-950 px-2 py-1.5`, scroll horizontal)
   - Chaque langue = bouton (`rounded` quand active : `border-emerald-500/60 bg-emerald-500/15`)
   - Badge "src" sur la langue source, badge missing count sur les autres
   - Bouton "+" (border-dashed) à la fin pour ajouter une langue
3. **Warning banner** (conditionnel, si on est sur la default lang) : `border-b border-amber-600/40 bg-amber-600/5 text-amber-200`
4. **Contrôles mode + filtre** (`border-b px-4 py-2`)
   - Gauche : segmented control **Visual** / **YAML**
   - Droite (mode Visual) : filtre Missing / Translated / All
5. **Body**
   - **Visual** : liste scrollable, chaque row affiche key (font-mono), source text (read-only ou éditable si on est sur la langue source), textarea target, preview MiniMessage colorée
   - **YAML** : éditeur CodeMirror (thème zinc dark, folding, numéros de ligne)

### 10.2 `DataSourcesPanelContent`

Layout horizontal :

| Pane | Largeur | Contenu |
|---|---|---|
| **`DataSourcesSidebar`** | shrink-0 | Liste des sources (boutons left-aligned ; actif = `border-l-2 border-emerald-500`). Bouton "+ Créer" en bas |
| **Droite** | `flex-1 p-4` | Si sélection : `DataSourceEditor` (form name + type + configuration). Sinon : message "Sélectionne une source" centré |

### 10.3 `AssetsTab` (sous-onglet de la sidebar droite, pas du tab strip)

Split horizontal :

**Gauche** (`flex-1 p-3 flex flex-col gap-2`)
- Bouton "Upload PNG/SVG" (Button)
- Bouton "Importer une font" (Button variant=outline)
- Input "Search…"
- Chips de filtre : all / texture / glyph / font (actif = emerald)
- `AssetGrid` virtualisée — cards `border rounded p-2` avec thumbnail + nom

**Droite** (`w-72 shrink-0`, conditionnel si asset sélectionné)
- `AssetDetailPanel` — propriétés (ascent, height, namespace, etc.)
- Boutons "Renommer", "Dupliquer glyph" (si type=glyph), "Supprimer"

**Dialogs déclenchés** :
- `AssetUploadDialog` — drag-drop / file picker pour PNG/SVG, champs ascent + height + name
- `AssetImportFontDialog` — drag-drop d'un zip MCFont, parse + preview des glyphs

---

## 11. Title composer (édition des layers de titre d'un menu)

Quand un menu est sélectionné, l'EditorPane (onglet Edit) montre `MenuProperties` au centre et — selon le mode d'édition — une **3ᵉ colonne `LayersPanel`** apparaît à droite (~280 px, sticky).

### `LayersPanel`

Layout vertical :

1. **Header** : "Layers" (font-mono text-xs)
2. **`AddLayerControls`** : deux boutons "+ Image" et "+ Text" (drag depuis ces boutons pour placer le nouveau layer près du curseur, ou clic simple pour l'attacher au last-selected menu)
3. **Liste drag-reorderable** de `LayerListItem` :
   - Chaque ligne : icône type (image/text) + nom + bouton "×" delete
   - Drag handle pour réordonner
4. **`LayerEditForm`** (pied du panel, conditionnel si layer sélectionné)
   - **Layer Image** :
     - Asset picker
     - Coordonnées x, y (inputs numériques)
     - Toggle "Calibrer pour coffre" (ascent = -11)
     - Bouton "Duplicate glyph" (crée une copie de l'asset pour mute son `height` per-menu)
   - **Layer Text** :
     - Textarea MiniMessage (avec preview live des tags `<gold>`, `<bold>`)
     - Coordonnées x, y
     - `TextSizeSelector` (changer la taille de police)
     - `font_asset_id` (font picker optionnel)
   - **Layer Textarea** : ajoute aux champs Text → width, line_height, alignment (`left` / `center` / `right`)

### Manipulation directe sur le canvas
- Drag d'un layer → repositionne (x/y)
- Corner drag (`ResizeHandles`) → redimensionne (aspect locked par défaut)
- `WidthResizeHandle` (sur textarea) → resize horizontal seul

---

## 12. Dialogs / modales communes

| Dialog | Trigger | Contenu |
|---|---|---|
| **`NewProjectDialog`** | Bouton "+ Nouveau project" dans `ProjectSidebar` | Input nom + erreur conditionnelle + footer Cancel/Create |
| **`DeleteProjectDialog`** | Kebab menu "Delete" | Confirmation "Êtes-vous sûr ?" + warning irréversible + bouton "Supprimer" rouge |
| **`AssetUploadDialog`** | Bouton "Upload" dans AssetsTab | Drag-drop zone + champs ascent/height/name + preview |
| **`AssetImportFontDialog`** | Bouton "Importer une font" | Drag-drop zip MCFont + parse preview |
| **`CommitDialog`** | Bouton "Commit" dans la branch toolbar | Input message + footer Commit/Cancel |
| **Export validation errors** | Auto au clic "Export ZIP" si erreurs | Liste des erreurs + bouton Fermer |
| **Conflict resolution modal** | Apparaît si conflit éditeur ↔ disque | Diff side-by-side + choix "Use editor" / "Use server" / "Manual" |

Toutes basées sur `Radix Dialog` via le primitive shadcn `Dialog` (`DialogContent`, `DialogHeader`, `DialogTitle`).

---

## 13. `ProjectSidebar` (détaillé)

`<nav>` `flex h-full flex-col gap-3 p-2`. Bordure droite zinc-800, fond zinc-950.

De haut en bas :

1. **`NetworkDropdown`**
   - **Fermé** : bouton `w-full rounded border border-zinc-800 px-3 py-2 text-left`
     - Label "Network" (`text-[10px] uppercase tracking-wide text-zinc-500`)
     - Nom du network actif (`text-zinc-100`)
     - Caret ▼ à droite (si > 1 network)
   - **Ouvert** : dropdown `absolute z-10 mt-1 rounded border bg-zinc-950 shadow-lg`
     - Autres networks listés (boutons `w-full px-3 py-2 text-left text-sm`)
     - Divider
     - Lien "Gérer les networks →" (`text-xs text-zinc-400`)

2. **Section "Mes Projects"** (`flex-1 overflow-auto`)
   - Heading `px-2 py-1 text-[10px] uppercase`
   - DnD-kit context + Sortable
   - Chaque item :
     - Link `rounded px-2 py-1 pr-7 text-sm text-zinc-200 hover:bg-zinc-800`
     - Actif : `bg-zinc-800`
     - Drag handle `absolute right-1` (opacity 0 desktop, visible au hover ou mobile)

3. **Bouton "+ Nouveau project"** (conditionnel si `activeNetworkId`)
   - `mt-1 block w-full px-2 py-1 text-left text-xs text-zinc-400 hover:text-zinc-200`
   - Ouvre `NewProjectDialog`

4. **Section "Modules installés"** (`mt-3`)
   - Heading uppercase
   - Empty state : "Aucun module installé." (`rounded border border-dashed px-2 py-2 text-[11px]`)

5. **Lien `⚙ Paramètres`** (sticky bas)
   - `flex items-center gap-2 px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800` → `/settings`

---

## 14. Top bar — détail des boutons

### `LangSwitcher` (langue du project)

- **Trigger** : bouton `h-9 text-xs font-mono` affichant le code langue + caret ▾
- **Menu** (`align=end border-zinc-700 bg-zinc-900`)
  - Une row par langue : code en majuscules + badge "default" (`text-[9px]`) ou actions ★ (set-default) + × (remove)
  - Séparateur
  - Bouton "+ Add language" (`text-emerald-300`)

### Undo / Redo
- Deux `h-9 w-9` icon buttons (Undo2 / Redo2)
- `opacity-50 cursor-not-allowed` si rien dans la pile

### Deploy buttons
- **Revert** : `h-8 text-xs text-zinc-400`, label "Annuler"
- **Deploy** : `h-8 bg-emerald-700 text-xs font-medium text-white`, label dynamique "Déployer" / "Déploiement…"

### `TopBarKebabMenu` (⋮)
- Trigger : icône MoreVertical `h-8 w-8`
- Items du dropdown :
  1. Export ZIP
  2. Import
  3. Export
  4. Patterns
  5. ─── (separator)
  6. **Delete** (`text-red-400`)

---

## 15. États spéciaux globaux

| État | Visuel |
|---|---|
| Pas authentifié | `ProjectSidebar` masquée, routes protégées redirigent vers `/login` |
| Pas de project chargé | Le tab strip Overview/Translations/Data-Sources ne s'affiche pas ; le contenu montre un empty state ou le wizard |
| Conflit de sync | Bannière `fixed top-4 right-4 z-50 amber` qui s'auto-dismiss 5 s |
| Drag depuis Library | `LibraryDragOverlay` (ghost 48×48 px, `border-2 border-emerald-500/70`, `shadow-2xl`) qui suit le curseur |
| Erreur réseau | `Toaster` (sonner) en bas à droite |
| Matériau armé (cliquer = placer) | `ArmedBanner` apparaît en haut du Stage |

---

## 16. Inventaire des primitives shadcn/ui utilisées

`Button`, `Card`, `Dialog` (+ Header/Title/Content/Trigger), `DropdownMenu` (+ Item/Separator/Trigger/Content), `Input`, `Sheet`, `Tabs` (+ List/Trigger/Content).

Tous dans `editor/src/components/ui/`.

---

## 17. Inventaire des composants custom (par feature)

**Layout** : `ProjectSidebar`, `NetworkDropdown`, `NewProjectDialog`, `TopBarKebabMenu`, `SplitPane`, `Toaster`, `EditorLangSwitcher`.

**Canvas (`features/canvas/`)** : `Stage`, `MenuGroup`, `CommandGroup`, `DialogGroup`, `Edges`, `Selection`, `ContextMenu`, `EdgeTooltip`, `ItemTooltip`, `TextEditor`, `ArmedBanner`, `EmptyState`, `ConditionListEditor`.

**Title composer (`features/canvas/title/composer/`)** : `LayersPanel`, `LayerListItem`, `LayerEditForm`, `AddLayerControls`, `ResizeHandles`, `WidthResizeHandle`, `TextSizeSelector`, `TitleRender`, `PlainTitleForm`.

**EditorPane** : `FlowCanvas`, `ProjectProperties`, `MenuProperties`, `ElementEditor`, `CommandEditor`, `DialogEditor`, `Library`, `ItemTile`, `MaterialPicker`, `LibraryDragOverlay`, `LibraryDragGhost`.

**Assets (`features/assets/`)** : `AssetsTab`, `AssetGrid`, `AssetDetailPanel`, `AssetUploadDialog`, `AssetImportFontDialog`.

**Translations (`features/translations/`)** : `TranslationPanelContent`, `VisualBody`, `YamlBody`, `ModeTab`, `FilterTab`.

**Data sources (`features/data-sources/`)** : `DataSourcesPanelContent`, `DataSourcesSidebar`, `DataSourceEditor`.

**Auth (`features/auth/`)** : `LoginForm`, `SignupForm`, `LogoutButton`, `DiscordLoginButton`.

**Setup (`features/setup/`)** : `SetupWizard`, `Step1Network`, `Step2Server`, `Step3Project`, `Step4Install`.

**Branches (`features/branches/`)** : `BranchSwitcher`, `CommitDialog`, `HistoryPanel`, `PromoteButton`, `MergeButton`.

**Deploy / export (`features/deploy/` + `features/export/`)** : `DeployButtons` (Revert + Deploy), `runExportZip` utility, `PatternsGallery`.

**Top bar** : `TopBarIconButton`, `UndoRedoButtons`, `LangSwitcher`.

**Misc** : `DeleteProjectDialog`, `SchemaForm` (générateur de formulaires depuis JSON Schema, utilisé par les futurs modules).
