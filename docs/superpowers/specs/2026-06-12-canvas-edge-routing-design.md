# Canvas — routage propre des liens entre nœuds

**Date** : 2026-06-12
**Statut** : validé (brainstorming avec mockups visuels)

## Problème

Les liens entre menus sur le canvas sont brouillons :

- Tous les liens d'un nœud partent du même point (milieu-droit de la source) et arrivent au même point (milieu-gauche de la cible) — `Edges.tsx` utilise des ancres fixes.
- Le tracé actuel est un chemin orthogonal déformé par `bezier` + `tension 0.3` → courbes molles, jamais droites.
- Un aller/retour A↔B produit deux edges (`A->B` et `B->A`) qui se superposent.
- Une cible située à gauche de sa source génère une boucle vers l'arrière (la sortie est toujours à droite).
- Aucune flèche : la direction d'un lien est invisible.

## Décisions validées

| Question | Décision |
|---|---|
| Style de tracé | **Courbes bézier lisses** style node editor (tangentes horizontales/verticales au bord, comme Blender/React Flow). Choisi contre orthogonal-coudes et lignes droites, sur mockups simple + scène dense. |
| Édition manuelle | **Poignée libre** : drag de l'extrémité d'un lien le long du bord du nœud, position mémorisée. Choisi contre le modèle "4 ports par côté". |
| Aller/retour A↔B | Deux courbes séparées, naturellement décalées par la répartition des ancres (pas de fusion en lien bidirectionnel). |
| Flèches | Tête de flèche côté cible sur chaque lien. |

## Design

### 1. Routage automatique (défaut)

Nouveau module pur `editor/src/features/canvas/edgeRouting.ts` :

- **Choix du côté** : pour chaque edge, le côté de sortie (source) et d'entrée (cible) est choisi parmi haut/bas/gauche/droite selon la position relative des deux boîtes (angle entre centres). Une cible à gauche → sortie par le côté gauche.
- **Répartition des ancres** : pour chaque nœud, les edges touchant un même côté sont triés selon la direction du nœud opposé, puis espacés régulièrement le long de ce côté. Conséquences : plus de point de départ unique, et A→B / B→A obtiennent des ancres distinctes → deux courbes parallèles sans chevauchement.
- **Tracé** : bézier cubique. Tangentes perpendiculaires au côté de sortie/d'entrée, longueur proportionnelle à la distance entre ancres (clampée min/max). Deux nœuds alignés avec ancres en vis-à-vis = ligne droite.
- Tout est dérivé à chaque render (comme `deriveEdges`) : le drag d'un nœud re-route en temps réel.

`deriveEdges.ts` (dérivation des edges depuis les actions) ne change pas.

### 2. Édition manuelle des extrémités

- Clic sur un lien → état "edge sélectionné" ; une poignée apparaît à chaque extrémité.
- Drag d'une poignée : aimantée au périmètre du nœud, repositionnable n'importe où sur le bord.
- Représentation : `Anchor = { side: "top" | "right" | "bottom" | "left", t: number }` avec `t ∈ [0,1]` ratio le long du côté → survit au redimensionnement du nœud (changement de `rows` d'un menu).
- Une extrémité overridée est fixe ; l'autre reste automatique tant qu'elle n'est pas touchée. Les ancres automatiques du même côté se répartissent en tenant compte des positions overridées.
- Reset : double-clic sur la poignée → retour à l'automatique (suppression de l'override).

### 3. Persistance

- Nouveau champ domaine : `pack.canvasEdges: Record<string, { from?: Anchor; to?: Anchor }>`, clé = id d'edge existant (`"source->target"`). Miroir exact du pattern `canvasLayout`.
- Export (`transform.ts`) : bloc `editor_edges` dans `manifest.yaml`, à côté d'`editor_layout`. Seulement les overrides ; filtré sur les ids vivants (mêmes règles de pruning qu'`editor_layout`). Omis si vide.
- Import : round-trip inverse (`editor_edges` → `pack.canvasEdges`), entrées orphelines ignorées.
- Store : actions `setEdgeAnchor(packId, edgeId, end, anchor)` / `clearEdgeAnchor(packId, edgeId, end)` dans `accountStore.ts`.

### 4. Rendu (`Edges.tsx`)

- Remplace le `Line` orthogonal+tension par le path bézier de `edgeRouting` (Konva `Shape`/`Path` ou `Line` bezier avec les vrais points de contrôle).
- Tête de flèche à l'arrivée (triangle orienté selon la tangente finale).
- Conserve : hover (`EdgeTooltip`, `hitStrokeWidth: 12`), highlight sélection (`--brand` / `--border` via `useCssVar` — pas de hex en dur, canvas Konva exempté de la règle tokens mais on garde les CSS vars existantes).
- Ajoute : sélection d'edge au clic, poignées (cercles draggables) sur l'edge sélectionné.

## Hors scope

- Évitement d'obstacles (un lien peut traverser un nœud non concerné).
- Fusion visuelle des liens bidirectionnels.
- Auto-layout des nœuds (inchangé, `autoLayout.ts`).
- Édition des points intermédiaires du tracé (seules les extrémités sont éditables).

## Tests

- `edgeRouting.test.ts` : choix du côté (4 quadrants), répartition multi-edges sur un même côté, stabilité du tri, ancres overridées mélangées aux automatiques, paramétrage `{side, t}` ↔ coordonnées, points de contrôle (alignés = droite).
- `accountStore.test.ts` : set/clear des anchors, pruning à la suppression de nœud.
- `transform.test.ts` : round-trip `editor_edges`, omission si vide, filtrage ids morts.
- Composant : edge sélectionnable, poignées visibles sur sélection, double-clic reset.

## Docs à mettre à jour

- `docs/architecture/editor-internals.md` — section canvas layout (routage, ancres, `canvasEdges`).
