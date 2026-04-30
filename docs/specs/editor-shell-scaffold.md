# Interfaze — Editor shell scaffold

**Status :** draft (2026-04-30)
**Scope :** spec du scaffold v0 de l'éditeur web — l'UI actuelle dans `web/` est jetée et remplacée par cette nouvelle shell qui introduit la notion de **workspace drag-and-drop** à 3 niveaux.

Ce document complète :

- [`main-spec.md`](main-spec.md) — spec produit globale
- [`web-editor.md`](web-editor.md) — spec UX éditeur (à mettre à jour, voir §10 ci-dessous)
- [`../decisions/editor-state-model.md`](../decisions/editor-state-model.md) — ADR backend-authoritative + broadcast (s'applique à la v1, pas au scaffold v0)
- [`../decisions/stack.md`](../decisions/stack.md) — décisions de stack

---

## 1. Décisions consolidées (issues du brainstorm)

| Décision | Détail |
|---|---|
| Pack hermétique | Pas de cross-pack template ref, pas de cross-pack i18n. §12.9 main-spec ("soft boundary") est annulée. |
| i18n scoped au pack | Chaque pack a son namespace ; clés exportées dans le `.itfz` ; plus de merge cross-pack à l'import. Annule §10.10 "scope workspace + import de pack". |
| 1 canvas = 1 pack | Pas de canvas multi-pack avec zones englobantes. Chaque pack a son propre canvas Figma-like, clos sur lui-même. |
| Shell à 3 niveaux | Account home (grille de packs) → Pack canvas (graphe de menus/cmds) → Menu editor (grille 9×N + props). |
| Scaffold v0 = frontend pur | React + state in-memory + localStorage + données mockées. Pas de backend, pas de WS, pas d'auth. |
| Renommage `SlotData` → `Element` | Aligne avec `menu/v1` schéma (§8.1 main-spec). |

---

## 2. Modèle domain

```
Account (1)
└── Pack (N)              — unité hermétique, exportable en .itfz
    ├── Menu (N)
    │   └── Layer (N)
    │       └── Element (N)
    │           └── Appearance (N)
    ├── Command (N)
    ├── Template (N)
    ├── Asset (N)
    └── I18nKey (N)
```

**Invariant pack hermétique** : pour tout `Pack p`, toute référence sortante (template, i18n key, `open_menu` action) doit cibler une entité **du même pack**. Validateur enforced côté store et côté schema, lint à l'import / save.

Types TS sources de vérité dans `web/src/domain/` (purs, sans couplage UI). À terme migrés dans `packages/schema` quand on splittera.

---

## 3. Shell — 3 niveaux

### 3.1 Niveau 1 — Account home (`/`)

- Grille responsive de **pack cards** (shadcn `Card`).
- Chaque card : nom du pack, icône optionnelle, badge `source` (`user_created` / `imported` / `forked`), résumé (`N menus · N cmds · modified Xh ago`).
- Card "+ New pack" en fin de grille.
- **Drag-and-drop** :
  - Drag d'une pack card pour réordonner (mémorisé en localStorage, ordre par account).
  - Drop d'un menu (drag depuis un canvas de pack ouvert, scope cross-route via Zustand) sur une pack-card → mutation `moveMenuToPack(menuId, fromPackId, toPackId)`. Le menu disparaît du pack source.
- Lib : `@dnd-kit/core` + `@dnd-kit/sortable`.

### 3.2 Niveau 2 — Pack canvas (`/pack/:packId`)

- Canvas infini React Flow.
- **Nodes** :
  - `MenuNode` — carré arrondi, mini-grille 9×N rendant le `background` + premier element par position (preview), titre du menu en header.
  - `CommandNode` — forme/couleur distincte (orange), affiche `name` + flèche vers le menu ouvert s'il y en a une.
- **Edges** : auto-dérivées depuis les `open_menu` actions trouvées dans n'importe quel `click` ou `command.actions` du pack. **Jamais stockées** — recalculées à chaque mutation du pack, mémoizé.
- **Position des nodes** : stockée par pack en localStorage (clé `interfaze:layout:pack:<packId>`). Auto-layout (force-directed) la première fois si position absente.
- **Drag-and-drop** :
  - Drag d'un node dans le canvas = update position (state local du store `packCanvas`).
  - Drag-out d'un node hors du canvas (vers un sidebar / breadcrumb / overlay) → trigger `moveMenuToPack` via une zone de drop visible (à designer dans le scaffold, premier essai : afficher la liste des autres packs en sidebar contextuelle quand un drag-out est en cours).

### 3.3 Niveau 3 — Menu editor (`/pack/:packId/menu/:menuId`)

- Layout 5 zones (toolbar / palette / canvas / properties / status bar) — reprend la structure de [`web-editor.md`](web-editor.md) §5.1, mais réécrit from scratch côté code.
- **Pour le scaffold v0** : implémenté en stub minimal :
  - Toolbar : breadcrumb + nom du menu + boutons placeholder (pas de publish, pas d'undo/redo bouton — undo/redo via Ctrl+Z fonctionnel via zundo).
  - Palette gauche : un seul onglet "Vanilla" avec une liste statique de matériaux mockés.
  - Canvas central : grille `size` slots (9 × `rows`), sélection, slot rouge si erreur (mocké).
  - Properties droite : pour le slot sélectionné, champs `material`, `title`, `lore`, `count` éditables. Section "click.left" en read-only stub.
- **Drag-and-drop** : drag d'un material depuis la palette vers un slot → mutation `setElementMaterial(elementId, material)`.
- Pas de Layers, pas d'Apparences, pas de Templates, pas de view states au scaffold — juste un Element par position avec une seule Appearance par défaut. Architecture data prête à recevoir les couches plus tard.

### 3.4 Routing

[TanStack Router](https://tanstack.com/router) — routes type-safe, params validés.

```
/                                          → AccountHomeRoute
/pack/:packId                              → PackCanvasRoute
/pack/:packId/menu/:menuId                 → MenuEditorRoute
```

Loaders : préchargent les data depuis le store mocké, suspense propre.

---

## 4. State management

### 4.1 Stores Zustand

- **`useAccountStore`** : list/CRUD packs, ordre des packs, mutations CRUD menus/commands cross-pack (move).
- **`usePackCanvasStore`** (instancié par `packId`) : positions des nodes du canvas, edges dérivées (computed selector).
- **`useMenuDraftStore`** (instancié par `menuId`) : draft du menu courant en édition. Wrappé dans `zundo` pour undo/redo local. State purgé au `unmount` de la route.

### 4.2 Persistance scaffold v0

- Tous les stores synchronisent leur state vers localStorage à chaque mutation (middleware Zustand `persist`).
- Données initiales : fixtures dans `web/src/mock/` chargées si localStorage est vide.
- **Pas de réseau, pas de backend, pas de WS au scaffold v0.**

### 4.3 Migration vers v1 (hors scope scaffold)

L'ADR [`editor-state-model.md`](../decisions/editor-state-model.md) statue que la v1 sera backend-authoritative + LWW + broadcast WS aux browsers et au plugin. Les stores Zustand resteront en place ; on substituera juste leur source de vérité (`persist` localStorage → `partysocket` WS) et on appliquera les events broadcast côté reducer. Le contrat d'event mutation reste à définir (ADR pending : "taxonomie des mutations").

---

## 5. Project structure

Repo plat. Le contenu actuel de `web/` est remplacé.

```
web/
  package.json          — react 19, vite 6, ts strict
  vite.config.ts
  tsconfig.json
  biome.json            — lint/format
  tailwind.config.ts
  index.html
  src/
    main.tsx            — root, router provider
    routes/             — TanStack Router file-based routing
      __root.tsx
      index.tsx                              — Account home
      pack.$packId.tsx                       — Pack canvas
      pack.$packId.menu.$menuId.tsx          — Menu editor
    features/
      account/
        PackGrid.tsx
        PackCard.tsx
        NewPackDialog.tsx
      pack-canvas/
        Canvas.tsx                           — React Flow wrapper
        nodes/MenuNode.tsx
        nodes/CommandNode.tsx
        deriveEdges.ts                       — open_menu → edges
        autoLayout.ts                        — initial force-directed
      menu-editor/
        Toolbar.tsx
        Palette.tsx
        InventoryGrid.tsx
        Properties.tsx
    domain/
      types.ts                               — Account, Pack, Menu, Command, Template, Element, Appearance, Layer, I18nKey
      invariants.ts                          — assertPackHermetic, validateMove
      ids.ts                                 — id generators
    state/
      accountStore.ts
      packCanvasStore.ts
      menuDraftStore.ts
    mock/
      fixtures.ts                            — 3 packs, ~10 menus, ~30 elements
    components/ui/                           — shadcn (button, card, dialog, input, ...)
    lib/
      cx.ts
      format.ts
    styles/
      globals.css
      tokens.css                             — dark theme tokens
  tests/
    unit/
      invariants.test.ts
      moveMenu.test.ts
    e2e/
      smoke.spec.ts                          — load → click pack → click menu
```

**Pas de monorepo au scaffold.** Quand on ajoutera le backend, on splittera en `apps/web` + `apps/server` + `packages/schema` via pnpm workspaces. Le code dans `domain/` est écrit pour cette extraction (zéro dépendance React).

---

## 6. Stack précisée

Per [`stack.md`](../decisions/stack.md), avec versions au 2026-04-30 :

| Dependency | Version | Rôle |
|---|---|---|
| `react`, `react-dom` | ^19.0.0 | UI |
| `vite` | ^6.0.0 | dev/build |
| `typescript` | ^5.7.0 (strict + `noUncheckedIndexedAccess`) | types |
| `@tanstack/react-router` | latest | routing |
| `zustand` | latest | state global |
| `zundo` | latest | undo/redo middleware |
| `@dnd-kit/core` + `@dnd-kit/sortable` | latest | drag-drop niveaux 1 et 3 |
| `reactflow` (`@xyflow/react`) | latest | canvas niveau 2 |
| `tailwindcss` | ^4.0.0 | styling |
| `class-variance-authority`, `tailwind-merge`, `clsx` | latest | utils Tailwind |
| `react-hook-form` + `zod` | latest | forms (properties panel) |
| `vitest` | latest | unit tests |
| `@playwright/test` | latest | e2e |
| `@biomejs/biome` | latest | lint + format |
| shadcn/ui components | copiés via `npx shadcn add` | primitives |

**Pas au scaffold v0** : `partysocket`, `@tanstack/react-query`, `sharp`, `archiver`, fastify et toutes les deps backend.

---

## 7. Scope v0 — IN / OUT

### IN

- 3 niveaux navigables avec data mockée (3 packs, ~10 menus, 1 commande)
- DnD aux 3 niveaux (réordonner packs · repositionner nodes · drag asset → slot)
- Move-to-pack via drag d'un node hors canvas
- Menu editor stub : grille `size` slots, sélection, properties basiques (`material`, `title`, `lore`, `count`)
- Undo/redo local (zundo) sur le menu draft
- Theme dark + tokens shadcn
- `assertPackHermetic` invariant et tests unitaires associés
- 1 smoke test Playwright

### OUT (V1+)

- Backend Fastify, Postgres, Drizzle, R2
- Auth Discord OAuth, sessions
- WebSocket broadcast et taxonomie des mutations (ADR pending)
- MiniMessage parser et preview live
- Éditeur i18n inline (touche `{`, "+ Nouvelle clé", auto-extract)
- Layers + Apparences conditionnelles (data ready, UI plus tard)
- Templates user-defined avec variables
- Asset upload réel (fichier, normalization, hash de doublons)
- Plugin tiers palette (composants, layouts suggérés)
- Intégration Nexo / ItemAdder
- Resource pack generation (CMD strings, polices custom, .zip, signature)
- Plugin Java
- Édition de commandes
- Multi-utilisateur, équipes, billing, freemium, Stripe
- Onboarding wizard

---

## 8. Testing v0

- **Vitest** :
  - `invariants.test.ts` — pack hermétique : insérer un menu avec un `open_menu` cross-pack doit fail.
  - `moveMenu.test.ts` — déplacer un menu d'un pack à l'autre conserve son id et tous ses elements ; le menu disparaît du pack source ; les `open_menu` cross-pack sont rejetés.
  - Tests Zustand stores : mutations de base (add/remove pack, set element material).
- **Playwright** :
  - `smoke.spec.ts` — load app → la home affiche au moins 3 packs → click un pack → canvas affiche au moins 1 node → click un node → menu editor affiche grille + palette + properties.

Pas de coverage targets — c'est un scaffold, on ajoutera des tests au fur et à mesure.

---

## 9. Conventions

- TypeScript strict (`strict: true, noUncheckedIndexedAccess: true`).
- Biome format à chaque save (config dans `biome.json`).
- Imports absolus via alias `@/` → `web/src/`.
- Composants : functional + hooks, pas de class.
- CSS : Tailwind + occasionnels `*.module.css` pour les composants spatiaux complexes (Canvas wrapper).
- Tests à côté de la source : `Foo.tsx` + `Foo.test.tsx` quand pertinent ; tests d'invariants centralisés dans `tests/unit/`.

---

## 10. Incohérences spec à réconcilier (suivi)

À retraiter dans une mise à jour ciblée des specs existantes (hors scope scaffold) :

1. **Multi-admin lock vs broadcast.** [`main-spec.md`](main-spec.md) §11.2 et [`web-editor.md`](web-editor.md) §5.9, §9.5 décrivent un soft-lock + Take Over. L'ADR [`editor-state-model.md`](../decisions/editor-state-model.md) (accepted 2026-04-29) annule ça au profit d'un backend-authoritative + LWW + broadcast + indicateur de présence. → mettre à jour main-spec et web-editor.
2. **Persistance du draft.** main-spec §11.4 parle d'autosave 10s côté éditeur web ; l'ADR fait du backend l'autorité. → aligner sur l'ADR (browser optimistic + localStorage filet, snapshot DB côté backend).
3. **Workspace vs serveur.** [`web-editor.md`](web-editor.md) §4.2 dit "Changer de serveur recharge la liste de menus", mais menus / packs vivent au niveau **workspace** (= account dans cette spec). → corriger : sélecteur serveur n'affecte pas la liste de packs, juste la cible WS / publish / palette plugin tiers.
4. **Plugins tiers visibles par serveur.** main-spec §13.7 — si un menu utilise QuestX et qu'on est connecté à un serveur sans QuestX, l'éditeur affiche "indisponible". → expliciter ce contrat dans web-editor.
5. **Pack hermétique.** main-spec §12.9 ("soft boundary cross-pack") **est annulée** par cette spec. → réécrire §12.9.
6. **i18n par pack.** main-spec §10.3 dit "scoped au workspace de l'admin" et §10.10 décrit la logique de merge à l'import. → réécrire §10.3 et §10.10 pour refléter le scope par pack.
7. **Vocabulaire `slot` vs `Element`.** main-spec §8.1 dit Element canonique ; web-editor utilise "slot" partout. → normaliser : domain = Element ; UI utilisateur peut continuer à dire "slot" mais code = Element.
8. **Versions Node.** main-spec §17.3 dit "Node.js 20+", stack.md dit "Node 22". → aligner sur 22 (déjà la décision dans stack.md).
9. **Taxonomie des mutations WS.** ADR `editor-state-model.md` mentionne un ADR "à venir" — pas encore écrit. → bloquant pour la v1 (post-scaffold).
10. **Onboarding `shop_demo`.** [`web-editor.md`](web-editor.md) §3.2 ne dit pas dans quel pack le menu de démo atterrit. → trancher : pack `Personal` auto-créé, le menu `shop_demo` y est ajouté.

---

## 11. Suite

Une fois ce design validé, écrire le plan d'implémentation détaillé (skill `writing-plans`) qui décompose le scaffold en étapes vérifiables avec critères d'acceptation par étape.
