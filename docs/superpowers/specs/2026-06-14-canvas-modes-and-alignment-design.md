# Canvas : modes d'interaction (toolbar) + guides d'alignement — Design

> Spec brainstormée le 2026-06-14. Deux features de UX de la planche (canvas Konva) : (A) une toolbar bas-centre avec des modes d'interaction **Sélection / Main (pan)** façon Figma, et (B) des **guides d'alignement + snapping** au drag des nœuds. Indépendantes — shippables en phases. Source de vérité pour le plan.

**Statut** — Spec validée en brainstorming, à transformer en plan.

---

## 1. Contexte (modèle d'interaction actuel)

- `Stage.tsx` : `<KonvaStage draggable>` → glisser sur le vide **pan** (drag natif Konva), synchronisé via `syncViewportFromStage` → `usePanZoom` (`viewport {x,y,scale}`). `onWheel` = zoom, pinch 2 doigts = zoom (`useStageTouch`).
- Sélection : **clic seulement** (`onStageClick` : clic sur un nœud sélectionne ; clic sur le vide, garde `e.target === stage`, clear). **Pas de marquee** aujourd'hui. `selectionStore` : `set/add/toggle/clear`, `ids: Set`.
- Nœuds (`MenuGroup` board / `CommandGroup` / `DialogGroup`) : `draggable`, `onDragStart`=moveToTop, `onDragEnd`→`setCanvasPosition(pack.canvasLayout)`. **Pas de `onDragMove`** sur les nœuds (point d'accroche libre pour B).
- Géométrie des boîtes : `nodeBox(pack, id, layout)` → `{x,y,width,height}` (menu via `menuBoxSize(rows)`, `COMMAND_BOX`, `DIALOG_BOX`).
- Layer overlay : `<Layer name="overlay">` (héberge `<Selection>` = Transformer `listening={false}`) → on y dessinera le marquee + les guides.
- Clavier (`useCanvasKeyboard`) : Ctrl/⌘ Z/Y/C/V/D, Delete, Esc. **V / H / Espace libres** (aucun conflit).
- Chrome DOM sur le canvas : `ArmedBanner` (top-3, z-20). Le wrapper `stage-bg-dots relative` → une toolbar bas-centre `z-20` ne conflicte pas.

---

## A. Modes d'interaction + toolbar

### A.1 État
- `uiStore.canvasMode: "select" | "hand"` + `setCanvasMode`. **Défaut `"select"`, persisté** (sticky entre sessions ; déjà un store `persist`).
- État éphémère `spaceHeld` (local au Stage ou uiStore non-persisté) pour la main temporaire à l'espace.

### A.2 Mode Main (`hand`)
- Stage `draggable = (canvasMode === "hand") || spaceHeld`. Glisser = pan (comportement actuel). Curseur `grab`/`grabbing`.
- Les clics ne sélectionnent pas (navigation pure) — `onStageClick` court-circuité en mode hand (sauf placement d'`armedMaterial`, conservé).

### A.3 Mode Sélection (`select`, défaut)
- Stage **non** `draggable` → le drag sur le vide est disponible pour le **marquee**.
- **Marquee (nouveau)** : pointerdown sur le vide (target === stage) → démarrer un rectangle ; pointermove → agrandir (dessiné sur le layer overlay, en coords monde via `screenToWorld`) ; pointerup → sélectionner tous les nœuds **on-board** dont la `nodeBox` **intersecte** le rectangle (intersection, pas inclusion totale). **Shift** = ajouter à la sélection existante ; sans Shift = remplacer. Clic simple (sans drag) sur le vide = clear (comportement actuel). Clic/drag sur un nœud = sélection/déplacement (inchangé).
- Implémentation : hook `useMarqueeSelection({ stageRef, viewport, pack, layout })` (gère pointer down/move/up + hit-test rect∩box) + composant overlay `<MarqueeRect>` (lit l'état du rect). Le hit-test réutilise `nodeBox` pour chaque nœud présent dans `layout`.

### A.4 Toolbar (DOM)
- Overlay DOM bas-centre (`absolute bottom-4 left-1/2 -translate-x-1/2 z-20`), design-system : deux boutons **▣ Sélection** / **✋ Main** (icônes lucide, ex. `MousePointer2` / `Hand`), l'actif mis en avant (`--brand-soft`). Composant `CanvasToolbar.tsx`. i18n pour les labels/tooltips.
- Tooltips affichent le hotkey (`V` / `H`).

### A.5 Clavier
- **V** → mode select, **H** → mode hand (dans `useCanvasKeyboard`, ignorés si un input est focusé). **Espace maintenu** → `spaceHeld=true` (main temporaire) ; relâché → revient au mode courant. (keydown/keyup espace ; ignore si saisie en cours.)

### A.6 Tactile
Inchangé : 1 doigt = pan (`usePanZoom`), tap = sélection, long-press = menu contextuel (`useStageTouch`), 2 doigts = pinch zoom. Les modes + marquee sont **pointeur/desktop**. (Pas de marquee tactile en V1.)

---

## B. Guides d'alignement + snapping

### B.1 Déclenchement
Ajouter `onDragMove` aux nœuds board (`MenuGroup` non-solo, `CommandGroup`, `DialogGroup`) → un hook partagé `useNodeAlignment` appelle la fonction pure `alignmentGuides(dragged, others, threshold)`.

### B.2 Fonction pure `alignmentGuides.ts`
```ts
interface Box { x: number; y: number; width: number; height: number; }
interface Guide { axis: "x" | "y"; pos: number; from: number; to: number; } // ligne à dessiner
interface AlignResult { snapX?: number; snapY?: number; guides: Guide[]; }
export function alignmentGuides(dragged: Box, others: Box[], threshold: number): AlignResult;
```
- Références comparées : **left / centerX / right** du nœud déplacé vs left/centerX/right de chaque autre → alignement vertical (même colonne) → candidate `snapX` + guide `axis:"x"`. **top / centerY / bottom** vs ceux des autres → alignement horizontal (même ligne) → candidate `snapY` + guide `axis:"y"`.
- On retient le meilleur candidat par axe dans le `threshold` (≈ `6 / viewport.scale` px monde). `snapX/snapY` = la coordonnée (x ou y du coin haut-gauche) ajustée pour réaliser l'alignement. `guides` = lignes pleine-étendue couvrant le nœud déplacé + le(s) nœud(s) alignés (from/to = min/max des extrémités concernées).

### B.3 Application (drag)
- Pendant le drag : le hook calcule `alignmentGuides`, **repositionne le nœud Konva** (`node.x(snapX)`, `node.y(snapY)`) quand un snap existe, et publie les `guides` actifs dans un état léger (store `useAlignmentStore` ou état Stage) lu par `<AlignmentGuides>` (overlay, lignes brand `listening={false}`).
- **Alt maintenu** → `alignmentGuides` court-circuité (déplacement libre, pas de snap ni guide).
- À `dragEnd` : persister la position finale (snappée) via `setCanvasPosition` existant ; vider les guides.

### B.4 Données comparées
`others` = `nodeBox` de tous les nœuds on-board **sauf** celui déplacé. Le `dragged` box = position live du nœud (`node.x()/y()` pendant le drag) + dims `nodeBox`.

---

## Fichiers (haut niveau)

**Créés (éditeur)**
- `editor/src/features/canvas/CanvasToolbar.tsx` — toolbar DOM bas-centre (boutons modes).
- `editor/src/features/canvas/useMarqueeSelection.ts` + `MarqueeRect.tsx` — rubber-band en mode select.
- `editor/src/features/canvas/alignmentGuides.ts` (pur) + `useNodeAlignment.ts` + `AlignmentGuides.tsx` (overlay).
- (option) `editor/src/state/alignmentStore.ts` — guides actifs (ou état local Stage).

**Modifiés**
- `editor/src/state/uiStore.ts` — `canvasMode` (persisté) + setter ; (éphémère) `spaceHeld` si mis dans le store.
- `editor/src/features/canvas/Stage.tsx` — `draggable` gaté sur le mode ; curseur par mode ; brancher `useMarqueeSelection` + `<MarqueeRect>` + `<AlignmentGuides>` dans le layer overlay ; monter `<CanvasToolbar>` dans le wrapper ; court-circuiter `onStageClick` en hand.
- `MenuGroup.tsx` (board) / `CommandGroup.tsx` / `DialogGroup.tsx` — ajouter `onDragMove` → `useNodeAlignment`.
- `editor/src/features/canvas/useCanvasKeyboard.ts` — hotkeys V / H / Espace.
- `editor/src/locales/en.ts` + `fr.ts` — labels toolbar (`canvas.modeSelect`, `canvas.modeHand`…).

---

## Phasage
- **Phase A1** : `canvasMode` + toolbar + stage draggable gaté + curseur + hotkeys V/H/Espace + hand court-circuite les clics. (Pas encore de marquee — le mode select se comporte comme aujourd'hui mais sans pan-au-drag-vide.)
- **Phase A2** : marquee (`useMarqueeSelection` + `MarqueeRect`) en mode select.
- **Phase B** : guides d'alignement + snap (indépendant ; peut précéder ou suivre A).

---

## Tests
- `alignmentGuides` (pur) : boîtes alignées L/centerX/R/T/centerY/B → guides + snapX/snapY corrects ; rien hors threshold ; Alt = pas de calcul (testé au niveau hook).
- `useMarqueeSelection` / hit-test : rect ∩ boxes → bons ids ; Shift = additif ; clic sans drag = clear.
- Modes : `setCanvasMode` ; Stage `draggable` reflète le mode (+ spaceHeld) ; hand court-circuite la sélection au clic.
- `CanvasToolbar` : rend les 2 modes, l'actif marqué ; clic change le mode ; hotkeys V/H.
- Non-régression : pan/zoom/pinch, clic-sélection, drag node + `setCanvasPosition` inchangés en mode select.

## Non-goals (V1)
- Guides de **distribution / espacement égal** (multi-sélection equidistante) — V2.
- Snap-to-grid global, règles/rulers.
- Outils rotate/scale.
- Marquee tactile.
- Mode « placement/création » dédié (création reste via clic-droit / panneau).
