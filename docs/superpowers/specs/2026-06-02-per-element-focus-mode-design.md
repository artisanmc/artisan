# Per-Element Focus Mode — Design

> ⚠️ **SUPERSEDED (2026-06-13)** par [`2026-06-13-workspace-board-curation-design.md`](./2026-06-13-workspace-board-curation-design.md). Le focus mode décrit ici a été **construit puis reverté** : sa cause d'échec était deux surfaces d'édition parallèles (canvas + éditeurs `MenuEditor`/`CommandEditor`/`DialogEditor` distincts) qui **divergeaient**. La nouvelle spec garde la vue par élément mais (1) impose un **rendu unique partagé** planche↔vue individuelle (pas de réécriture d'éditeur), et (2) remplace « le canvas garde tout » par une **planche curée + panneau source-de-vérité**. Conservé pour ses designs d'éditeurs par type (Menu/Command/Dialog), réutilisables comme contenu de la vue individuelle.

> Spec brainstormée le 2026-06-02 pour éclaircir l'éditeur quand on travaille sur UN élément, tout en gardant le canvas multi-éléments comme overview principal.

**Statut** — Superseded (voir bandeau ci-dessus). Jamais shippé (reverté).

---

## 1. Goal

Aujourd'hui le workspace = un canvas Konva unifié qui mélange menus, commandes et dialogs sur la même surface, avec un panneau properties à droite (~280 px) pour éditer le détail de l'élément sélectionné. Le canvas est précieux pour visualiser les relations inter-éléments via les edges, mais coince les commandes et les dialogs dans un espace d'édition trop étroit. Quand un module HUD arrivera, la situation va empirer.

**Cette spec ne remplace pas le canvas** — il garde sa valeur d'overview unique. À la place, on ajoute :

1. **Un refactor de propreté** : `MenuGroup.tsx` (1066 lignes) et `Stage.tsx` (528 lignes) sont éclatés en composants à responsabilité unique (~200 lignes max). Préalable obligatoire — on n'ajoute pas de nouveau code sur des fichiers de cette taille.
2. **Un focus mode** : nouvelle route `/workspace/$id/element/$elementId` qui rend tout l'écran à UN élément avec un éditeur adapté à son type. Accessible par double-click sur le canvas ou bouton dédié dans le panneau properties. Fermable par `Esc` ou bouton retour.

## 2. Non-goals (explicit out-of-scope)

Ces éléments ont été discutés en brainstorming et sont **délibérément reportés** :

| Item | Raison du skip |
|---|---|
| Cross-element navigation (jumps forward "Opens menu X" + reverse links "Used by /shop" + backstack) | Les edges du canvas suffisent en V1. À ajouter quand un manque concret émerge. |
| Sidebar drill-in (qui basculerait sur la liste d'éléments en mode focus) | La sidebar workspace reste stable partout — moins de complexité de navigation. |
| Dialog preview Minecraft natif | Demande un renderer de dialog 1.21+ ; slot prévu en V2. V1 = form + actions chain comme une commande. |
| Replacement complet du canvas par le focus mode | Le canvas a une valeur d'overview qu'on ne retrouve nulle part ailleurs. Le focus mode l'augmente, ne le remplace pas. |
| Suppression de `canvasLayout` persisté sur le Pack | Reste utilisé par le canvas. |
| Nouveau flow de création d'élément (sidebar `+` avec type picker) | La création reste sur le canvas via les composants existants `NewMenuDialog` / `NewCommandDialog` / `NewDialogDialog`. Cohérent avec "le canvas reste la vue principale". |

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  /workspace/$workspaceId                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Top bar (pack name, lang, undo/redo, branch, deploy)    │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │ Tabs: overview | translations | data-sources | servers  │    │
│  ├──────────────────────────────────────┬──────────────────┤    │
│  │ Stage (Konva)                        │ EditorPane        │    │
│  │  - MenuGroup × N                     │  - Edit / Library │    │
│  │  - CommandGroup × N                  │  - Assets         │    │
│  │  - DialogGroup × N                   │                   │    │
│  │  - Edges                             │  + bouton "Focus" │    │
│  └──────────────────────────────────────┴──────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
        │  double-click un element              ↓ bouton Focus
        ▼
┌─────────────────────────────────────────────────────────────────┐
│         /workspace/$workspaceId/element/$elementId              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ← Retour | 📋 elem name | lang | undo/redo | ... deploy │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                          │   │
│  │              ElementEditor (router)                      │   │
│  │           dispatch on element.type                       │   │
│  │      ┌──────────────┬──────────────┬──────────────┐      │   │
│  │      │ MenuEditor   │ CommandEditor│ DialogEditor │      │   │
│  │      │ (3-col)      │ (2-col / 1)  │ (2-col / 1)  │      │   │
│  │      └──────────────┴──────────────┴──────────────┘      │   │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

Workspace tabs **disparaissent** en focus mode (le focus est un sous-écran d'`overview`). Toutes les actions workspace-scope (lang, undo, branch, deploy, kebab) **persistent** dans le top bar focus.

## 4. Refactor split (Phase 1 + 2)

Préalable à toute nouvelle UX. Aucun changement comportemental — split de fichier uniquement.

### 4.1 `MenuGroup.tsx` (1066 → ~6 fichiers)

| Fichier (nouveau) | Responsabilité |
|---|---|
| `MenuGroupContainer.tsx` | Orchestrateur : position canvas, drag du menu entier, état sélection, plumb props vers enfants |
| `MenuBackground.tsx` | Rendering bg image custom ou vanilla chest |
| `MenuSlots.tsx` | Grille de slots, click handlers (open SlotEditor), drag-drop targets pour Library items |
| `MenuTitle.tsx` | Composition titre (intégration avec `title/composer/` existant) |
| `MenuGroupInteractions.tsx` | Event handlers globaux du menu (rightclick context menu, double-click → focus mode entry) |
| `menuGeometry.ts` | Helpers purs (coordinate math : slot position from row/col, hit-test, etc.) |

Le test suite existant (`MenuGroup.test.tsx`) reste — il doit passer après split sans modification de comportement. On peut ajouter quelques tests unitaires sur `menuGeometry.ts` (math pure facile à tester).

### 4.2 `Stage.tsx` (528 → ~4 fichiers)

| Fichier (nouveau) | Responsabilité |
|---|---|
| `StageContainer.tsx` | Konva Stage + Layer setup + viewport, render des children groups |
| `StageZoomPan.tsx` | Wheel/pinch zoom + drag pan + bounds |
| `StageDropTarget.tsx` | Hit-test depuis dnd-kit (étend `stageDropTarget.ts` existant) |
| `StageSelection.tsx` | Marquee selection rect, multi-select state + interactions |

`CommandGroup.tsx` (83 lignes) et `DialogGroup.tsx` (83 lignes) restent intacts.

### 4.3 Critère de validation

Un fichier qu'on ne peut pas tenir en tête en une lecture est trop gros. Cible ≤ 200 lignes par fichier. Test suite passe → split réussi.

## 5. Focus mode route + dispatch (Phase 3)

### 5.1 Nouvelle route TanStack

`editor/src/routes/workspace.$workspaceId.element.$elementId.tsx` — file route TanStack créée à côté de `workspace.$workspaceId.tsx`.

Charge le pack via le loader existant (`usePackLoader` ou `accountStore.packs.find(...)`), résout l'élément via :

```ts
const element =
  pack.menus.find(m => m.id === elementId) ??
  pack.commands.find(c => c.id === elementId) ??
  pack.dialogs.find(d => d.id === elementId);
```

Si introuvable → render empty state `"Cet élément n'existe plus"` + bouton retour vers `/workspace/$workspaceId`.

### 5.2 `ElementEditor` dispatcher

Composant racine de la route. Lit le type résolu et délègue :

```ts
function ElementEditor({ pack, element }: Props) {
  switch (element.kind) {
    case "menu":    return <MenuEditor pack={pack} menu={element} />;
    case "command": return <CommandEditor pack={pack} command={element} />;
    case "dialog":  return <DialogEditor pack={pack} dialog={element} />;
    default:        return <UnknownTypeFallback />;
  }
}
```

### 5.3 Top bar focus mode

Remplace le top bar canvas par :

```
← Retour | 📋 shop_menu | [lang ▾] [↶][↷] [Branch ▾] ... [Deploy] [⋮]
```

- `← Retour` → `navigate({ to: "/workspace/$workspaceId", params })`
- Type icon (📋 menu / ⌨ command / 💬 dialog) + nom de l'élément (i18n-aware)
- LangSwitcher, UndoRedoButtons, BranchSwitcher / DirtyBadge / Commit / Promote / Merge, DeployButtons, TopBarKebabMenu : extraits dans un composant partagé `WorkspaceTopBarControls` (refactor mineur de `workspace.$workspaceId.tsx`) puis montés à l'identique dans le top bar focus. Pas de duplication.
- Pour `MenuEditor` uniquement : deux boutons supplémentaires "📚 Library" et "🎨 Assets" qui ouvrent les panneaux flottants (cf. §6)

### 5.4 Workspace tabs en focus mode

Les tabs `overview / translations / data-sources / servers` **ne sont pas rendues** en focus mode. Le focus est un sous-écran d'`overview` ; les autres vues sont workspace-globales et n'ont pas de sens à l'échelle d'un élément.

### 5.5 Keyboard

- `Esc` → équivalent du bouton ← Retour. Capturé au niveau du composant route, non destructif (ne ferme pas si un input est focusé en cours d'édition — comportement standard).
- `Ctrl/⌘ + Z / Y` → undo/redo, fonctionne en focus mode identiquement au canvas (mêmes stores temporels).

## 6. `MenuEditor` (Phase 4)

### 6.1 Layout desktop (≥ lg)

3 colonnes — héritage direct du Title Composer v3 mais isolé à un seul menu :

```
┌────────────────────────────┬──────────────┬──────────────┐
│ Menu canvas (Konva)        │ Properties   │ Layers       │
│ — bg + slots + title       │ — rows       │ — title      │
│ — drag from Library popup  │ — permission │   layers     │
│ — slot click → edit slot   │ — actions    │              │
│ — fills available area     │ — ctxInputs  │              │
└────────────────────────────┴──────────────┴──────────────┘
```

Composants réutilisés :
- `MenuGroupContainer` + sous-composants (issus du split P1)
- `MenuProperties` (extrait de `pack.$packId.tsx` historique, déjà composant indépendant)
- `LayersPanel` + sous-composants (`LayerListItem`, `LayerEditForm`, `AddLayerControls`, `ResizeHandles`, `TitleRender`)

### 6.2 Library / Assets en panneaux flottants

Un seul menu n'a pas besoin de la Library en permanence comme l'écran multi-menus actuel. À la place :
- Bouton "📚 Library" dans top bar focus → ouvre un panneau drawer ancré à droite, dismissable (Esc ou click hors panneau)
- Bouton "🎨 Assets" → idem avec le contenu `AssetsTab`

Le drawer réutilise les composants existants `Library` et `AssetsTab`, juste hosted dans un wrapper drawer.

### 6.3 Mobile (< lg)

Single column avec tabs `Canvas / Properties / Layers / Library / Assets`, pattern `WorkspaceTabs` réutilisé. Le canvas est rendu à largeur viewport, properties et layers en bas via tabs.

## 7. `CommandEditor` (Phase 5)

### 7.1 Layout desktop (≥ lg) — Two-col 42/58

```
┌──────────────────────┬───────────────────────────────────┐
│ Meta (fixe, ~42%)    │ Actions chain (scrollable)        │
│ - trigger            │ ┌───────────────────────────────┐ │
│ - aliases (chips)    │ │ 1. IF player.balance ≥ 100    │ │
│ - permission         │ ├───────────────────────────────┤ │
│ - description (i18n) │ │   2. open_menu → shop_menu    │ │
│ - argParser config   │ ├───────────────────────────────┤ │
│                      │ │ 3. ELSE send_message          │ │
│                      │ └───────────────────────────────┘ │
│                      │ + Ajouter une action              │
└──────────────────────┴───────────────────────────────────┘
```

### 7.2 Layout mobile (< lg)

Single column, sections empilées dans l'ordre : meta → actions.

### 7.3 Actions chain — rendering

**Liste indentée style pseudo-code** (respect [[editor-ux-prefer-pseudocode]] — "indented text beats flow cards for nested logic"). Pas de FlowCanvas, pas de cards-and-arrows visuels.

Chaque action = un bloc card avec :
- Header type (`open_menu`, `IF`, `ELSE`, `send_message`, etc.)
- Indentation visuelle pour les blocs imbriqués (children d'un `IF`, par exemple)
- Body initialement compact (résumé sur 1 ligne, ex. `open_menu → shop_menu`) ; click n'importe où dans le bloc bascule en mode édition, le bloc se déplie pour montrer son form spécifique au type d'action ; click ailleurs ou `Esc` referme
- Drag handle pour réordonner (dnd-kit)
- Bouton `+` à la fin de la chaîne pour append, ou inline entre deux blocs pour insérer

L'action `open_menu` (et autres avec un targetId) affiche le nom de la cible **en texte plain** — pas de click jump en V1 (cross-nav skip). Le nom est résolu via `pack.menus.find(...)?.name ?? targetId`.

### 7.4 Data model

Aucun changement de modèle. Lit/écrit `pack.commands[i].actions[]` via les selectors existants d'`accountStore`. Les mutations passent par les actions store existantes (`updateCommandAction`, `addCommandAction`, etc. — créer si absents).

## 8. `DialogEditor` (Phase 6)

Même shape que `CommandEditor` (two-col desktop / single-col mobile).

Meta : title (i18n), body (textarea i18n), liste de boutons. Chaque bouton = label (i18n) + actions chain propre (mini-éditeur identique à celui des commandes, factorisé en `ActionsChainEditor` partagé).

Pas de preview Minecraft V1. Slot prévu pour V2 quand un renderer dialog 1.21+ existe — placeholder `<DialogPreview />` rendu vide en V1, switchable plus tard.

## 9. Entry points (Phase 7)

### 9.1 Double-click sur le canvas

Dans `MenuGroupInteractions` (et équivalents Command/Dialog), capture du double-click :

```ts
onDblClick={() => navigate({
  to: "/workspace/$workspaceId/element/$elementId",
  params: { workspaceId, elementId: element.id },
})}
```

Click simple → comportement existant (sélection). Drag → drag du nœud sur le canvas (existant). Pas de conflit : Konva distingue click / dblclick / dragstart.

### 9.2 Bouton "Focus" dans le panneau properties

Dans l'`EditorPane` du canvas, quand exactement UN élément est sélectionné, ajouter un bouton "Focus / Éditer en grand" en haut du panneau properties. Click → même `navigate` que double-click. Plus découvrable pour les nouveaux users.

### 9.3 Boucle complète

```
canvas → dblclick element → focus mode → édition → Esc / ← Retour → canvas (sélection préservée)
```

À la sortie du focus mode, la sélection de l'élément quitté reste active sur le canvas (la sélection est dans `selectionStore`, traversal de route ne la reset pas).

## 10. Testing strategy

### 10.1 Refactor split (P1 + P2)

- Tests existants `MenuGroup.test.tsx` (~150 cas) et tests Stage (smoke E2E `smoke.spec.ts`) doivent passer **sans modification** après split. Tout fail = bug de refactor.
- Tests unitaires ciblés à ajouter pour `menuGeometry.ts` (math pure, ~10-15 cas pour les helpers de slot position / hit-test).

### 10.2 Focus mode (P3-P7)

| Niveau | Couverture |
|---|---|
| Route | Test d'intégration : navigation directe par URL, empty state si elementId introuvable, navigate retour fonctionne |
| `ElementEditor` dispatcher | Tests unitaires : dispatch correct par type, fallback `UnknownTypeFallback` |
| `MenuEditor` | Reuse des tests existants du Title Composer v3 + 1 test "render isolé sans canvas multi-menus" + tests boutons Library/Assets ouvrant les drawers flottants |
| `CommandEditor` | Tests responsive (two-col ≥ lg, single < lg), édition inline d'une action, ajout/suppression/réorder, indentation pseudo-code pour `IF`/`ELSE`/nested |
| `DialogEditor` | Idem CommandEditor + tests sur les boutons multiples avec chaque action chain isolée |
| Entry points | Test dblclick sur MenuGroup → navigate, bouton Focus dans properties → navigate, Esc → retour |

Pas de tests E2E nouveaux. `smoke.spec.ts` actuel couvre l'overview canvas ; il n'a pas besoin d'extension pour le focus mode (testé en intégration React).

## 11. Phasing / implementation order

7 phases, chaque phase shippable indépendamment sans casser le canvas existant. Possibilité d'arrêter à n'importe quelle phase si priorités changent.

| Phase | Scope | UX visible ? | Risque |
|---|---|---|---|
| **P1** | Split `MenuGroup.tsx` → 6 fichiers | Non — refactor pur | Bas (test suite gate) |
| **P2** | Split `Stage.tsx` → 4 fichiers | Non — refactor pur | Bas (smoke E2E gate) |
| **P3** | Nouvelle route + `ElementEditor` dispatch + empty state + top bar focus | Oui — accessible par URL directe | Bas (nouveau code isolé) |
| **P4** | `MenuEditor` 3-col + flottants Library/Assets | Oui — utilisable | Moyen (composition de 4-5 composants existants) |
| **P5** | `CommandEditor` two-col + actions inline pseudo-code | Oui — utilisable | Moyen (nouveau editor + interactions inline) |
| **P6** | `DialogEditor` (factorise `ActionsChainEditor` partagé avec Command) | Oui — utilisable | Bas (clone de Command) |
| **P7** | Entry points : double-click canvas + bouton "Focus" dans properties + `Esc` | Oui — discovery complète | Bas (event handlers ajoutés) |

À P3, l'URL focus existe mais ressemble juste au canvas embarqué — pas d'utilité user. À P4-P6, les éditeurs sont fonctionnels mais seulement accessibles par URL directe. P7 ferme la boucle UX.

Estimation grossière (à affiner dans le plan d'implémentation) :
- P1 + P2 : 1 jour chacune (refactor mécanique gardé par les tests)
- P3 : ½ journée (route + dispatch + empty state)
- P4 : 1 journée (composition + flottants)
- P5 : 2 jours (le plus de logique nouvelle — actions inline editor)
- P6 : ½ journée (clone de Command + factorize)
- P7 : ½ journée (event handlers + Esc)

## 12. Future considerations (V2+)

**Cross-element navigation** — quand le focus mode est utilisé en pratique et qu'un manque concret de "voir qui ouvre ce menu" émerge, ajouter :
- Forward links : actions avec `targetId` deviennent cliquables → navigate vers le target
- Reverse links : panneau "Used by" dans chaque éditeur listant les éléments qui référencent celui-ci (selector dérivé `useReferenceMap(elementId)`)
- Backstack : store léger qui track la chaîne de navigation focus → focus, bouton ← qui défile

**Dialog preview Minecraft** — quand un renderer dialog vanilla 1.21+ existe côté éditeur, remplir le `<DialogPreview />` placeholder du DialogEditor.

**HUD module** — éditeur dédié style preview in-game Minecraft. Hors scope ; ce sera son propre module quand il arrivera, suivant le pattern modular monolith (`editor/src/modules/hud/`). Le focus mode décrit ici est extensible à ce type : ajouter `<HudEditor />` au dispatcher d'`ElementEditor` quand le module sera scaffolded.

**Replacement complet du canvas** — pourrait être reconsidéré si le focus mode prend toute la valeur d'usage et que le canvas devient un détour. À ce moment-là, la sidebar drill-in (rejetée en V1) redevient pertinente. Reporté tant que le canvas reste utilisé.
