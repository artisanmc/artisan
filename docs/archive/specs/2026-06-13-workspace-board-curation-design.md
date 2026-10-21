# Workspace : planche curée + panneau source-de-vérité + vue individuelle — Design

> Spec brainstormée le 2026-06-13. **Amende et supersède partiellement** [`2026-06-02-per-element-focus-mode-design.md`](./2026-06-02-per-element-focus-mode-design.md) : on garde son concept de vue par élément, on remplace son modèle de canvas (« le canvas garde tout » → « planche curée »), et on réintroduit le panneau de navigation qu'elle écartait. Source de vérité pour le plan d'implémentation associé.

**Statut** — Spec validée en brainstorming, à transformer en plan d'implémentation.

---

## 1. Le problème

Aujourd'hui le workspace est un **canvas libre type Canva** : `autoLayout(pack)` force *chaque* menu, commande et dialog dans une grille, et l'utilisateur peut les glisser pour les ranger (positions persistées dans `pack.canvasLayout`). `Edges` trace les liens entre eux.

Constat de l'utilisateur (mots propres) :

- Le canvas devient **le bordel dès une dizaine d'éléments** (spaghetti d'edges, grille dense).
- Son **seul vrai bénéfice** = visualiser quels menus/commandes sont liés — mais ce bénéfice n'apparaît **qu'après un travail de rangement manuel**.
- Il n'est **pas adapté à tous les éléments** : une commande qui n'ouvre aucun menu flotte « quelque part » sur le canvas, sans logique de placement.
- Ce qui est réellement utile et qu'il faut garder : **voir les liens menu→menu**, **afficher des menus côte à côte**, **copier-coller entre menus**.

Le job principal de l'utilisateur dans le workspace est **l'édition focalisée d'un élément** ; la vue d'ensemble spatiale est, pour cet usage, un coût plus qu'un bénéfice.

### 1.1 Leçon de l'ancien focus mode (reverté)

Un mode focus avait été construit puis **reverté**. Raisons (mots de l'utilisateur) : *« redondant avec le canvas, et pas mal de bugs — les éléments n'étaient pas fonctionnels ou désignés pareil, donc au lieu de corriger je les ai enlevés pour pas batailler »*.

→ La cause racine n'est pas l'idée du focus, mais **deux surfaces d'édition parallèles qui divergent**. C'est l'invariant n°1 de cette spec (§2).

## 2. Principes directeurs

1. **Une seule implémentation de rendu/édition par type d'élément.** La planche et la vue individuelle rendent un menu via *le même* composant (`MenuGroup` + sous-composants), une commande/dialog via *les mêmes* composants de flux. La vue individuelle = ce composant rendu **seul et centré**, pas une réécriture. Zéro divergence possible → la cause du revert disparaît.
2. **Découpler « exister dans le pack » de « être sur la planche ».** Le pack contient tous les éléments ; la planche n'en montre qu'un sous-ensemble choisi.
3. **La curation supprime la redondance.** Un élément hors-planche ne s'édite que via la vue individuelle ; le focus n'est donc plus un doublon du canvas.
4. **Mobile-first** ([[mobile-first]]) : aucune affordance hover-only, panneaux en drawers sous `lg`.
5. **Design-system d'abord** ([[design-system-first]]) : tout nouveau composant via `components/ui` + tokens, spécimen sur `/admin/design` si manquant.

## 3. Modèle de données

**`pack.canvasLayout` devient l'ensemble d'appartenance à la planche.** Un élément est « sur la planche » **ssi** il a une entrée explicite `canvasLayout[id] = {x, y}`.

- `autoLayout.ts` **ne remplit plus** la grille pour les éléments manquants. Il ne retourne que les entrées explicites de `pack.canvasLayout`.
- L'ancienne logique de grille est **conservée mais déplacée** dans une fonction `gridArrange(ids)` appelée uniquement par le bouton « Tout arranger sur la planche » (§8).
- Aucun changement de schéma DB ni de `Pack` type : `canvasLayout` existe déjà (`Record<string, {x,y}>`). Seule sa *sémantique* change (appartenance, pas juste position). À documenter dans `entities.md` / `editor-internals.md`.

### 3.1 Trois actions distinctes

| Action | Effet | D'où |
|---|---|---|
| **Ajouter à la planche** | Écrit `canvasLayout[id]` (à la position de drop, ou via `gridArrange`) | Drag panneau→planche, ou menu contextuel panneau |
| **Retirer de la planche** | Supprime `canvasLayout[id]` — **l'élément reste dans le pack** (toujours dans le panneau) | Menu contextuel sur un nœud de la planche, ou panneau |
| **Supprimer du pack** | Destructif : retire l'élément du pack (existant : `deleteFromPack`) | Panneau ou planche, avec confirmation |

Nouvelles actions `accountStore` : `addToBoard({packId, id, position?})`, `removeFromBoard({packId, id})`. `deleteFromPack` existe déjà.

## 4. Le panneau gauche — source de vérité

Nouveau composant `WorkspacePanel` (ou nom proche), 3ᵉ zone de l'overview, à gauche de la planche.

- Liste **tout** le pack, groupé par catégorie : **Menus**, **Commandes**, **Dialogs** (extensible aux futurs modules).
- **Recherche** (filtre texte sur nom/id).
- Chaque item affiche : icône de type, nom, et un badge **« sur la planche »** si présent dans `canvasLayout`.
- **Interactions** :
  - **Clic** → ouvre la **vue individuelle** de l'élément (§6). N'ajoute pas à la planche.
  - **Drag** → ajoute à la planche (drop sur le canvas place à la position du curseur).
  - **Menu contextuel** : Éditer (= clic) · Ajouter/Retirer de la planche · Dupliquer · Supprimer du pack.
- **Création** : bouton `+` par catégorie (ou unique avec type-picker) réutilisant `NewMenuDialog` / `NewCommandDialog` / `NewDialogDialog` existants. Un élément créé apparaît dans le panneau ; il n'est ajouté à la planche que si créé via clic-droit sur le canvas (flux existant) — sinon il vit hors-planche par défaut.
- Construit via design-system (`components/ui`, tokens). Pattern de drag : `dnd-kit` (déjà la dépendance du workspace).

## 5. La planche (canvas curé)

`Stage.tsx` ne mappe que les éléments présents dans `canvasLayout` (menus, commandes, dialogs confondus). Tout le reste du canvas (pan/zoom, sélection, edges, copier-coller, drop d'items Library sur slots) **reste identique**.

### 5.1 Chips fantômes (liens hors-planche)

Quand un nœud sur la planche référence une cible **absente** de la planche (ex. `hub` ouvre `shop`, mais `shop` n'est pas posé), on n'affiche pas un edge dans le vide. À la place, un **chip fantôme cliquable** sur le nœud source : `→ shop ↗`. Clic = `addToBoard(shop)` (et trace alors l'edge réel). `Edges.tsx` ne trace des edges qu'entre nœuds présents sur la planche ; les liens vers le hors-planche sont délégués aux chips.

### 5.2 Côté-à-côte & copier-coller

Ces deux besoins sont **déjà** servis par la planche (plusieurs nœuds visibles + `canvasClipboardActions` existants). La curation ne les retire pas — elle les rend plus utiles (on ne pose côte à côte que ce qu'on veut comparer). Aucune nouvelle UX nécessaire ici.

## 6. La vue individuelle (deep-linkable)

Nouvelle route enfant TanStack sous la route server-scoped actuelle :

```
/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId
```

(Le hook `childMatches` + `<Outlet/>` déjà présent dans `networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx` est exactement le point d'accroche — il bascule déjà le rendu vers la route enfant quand elle matche.)

- **Deep-linkable** : rechargement conserve la vue, bouton retour navigateur fonctionne, lien partageable.
- Résolution : `pack.menus/commands/dialogs.find(... === elementId)`. Introuvable → empty state « Cet élément n'existe plus » + retour planche.
- **Dispatch par type** (`ElementView` router) :
  - **Menu** → le **même** `MenuGroup` + sous-composants que la planche, rendu **seul, centré**, à largeur disponible. Cliquer un slot l'édite dans le pane de droite (comportement actuel inchangé).
  - **Commande / Dialog** → le **même** éditeur de flux que celui utilisé ailleurs, **centré** (liste indentée pseudo-code, cf. [[editor-ux-prefer-pseudocode]]) — pas de FlowCanvas cards-and-arrows. Le pane de droite porte les propriétés (trigger, cooldown, requirements / title, body, boutons).
- **Top bar focus** : `⟵ Retour à la planche` + icône type + nom + contrôles workspace partagés (`WorkspaceTopBarControls` existant, monté à l'identique). Pas de duplication de barre.
- `Esc` = retour planche (non destructif si un input est focusé).

> **Différence clé vs spec 2026-06-02** : celle-ci créait des composants `MenuEditor`/`CommandEditor`/`DialogEditor` distincts — la porte d'entrée de la divergence qui a causé le revert. Ici, `ElementView` **ne réimplémente rien** : il monte les composants de rendu déjà utilisés par la planche, en layout solo. La seule chose « nouvelle » est le conteneur de layout, pas l'édition.

## 7. Refactor prérequis

Pour que le principe n°1 (rendu partagé) tienne, le rendu d'un menu doit être **montable seul** aussi bien que dans la planche. Aujourd'hui `MenuGroup.tsx` (603 lignes) suppose un contexte de planche (position absolue, drag du nœud). Avant la vue individuelle :

- Extraire de `MenuGroup` un cœur de rendu **agnostique du contexte** (slots, background, titre, édition de slot) des préoccupations *planche* (position, drag inter-nœuds, sélection multi). Le nœud-de-planche devient un wrapper fin autour du cœur ; la vue individuelle monte le cœur directement.
- Idem au besoin pour l'éditeur de flux commande/dialog : un `ActionsChainEditor` partagé, utilisable centré (vue individuelle) comme dans le pane.
- Cible ≤ ~200 lignes/fichier, gardé par les test suites existantes (`MenuGroup.test.tsx` doit passer sans modif de comportement).

C'est un sous-ensemble du refactor P1/P2 de la spec 2026-06-02, recadré sur l'objectif « un seul rendu » plutôt que « split pour la taille ».

## 8. Migration & états vides

- **Packs existants** : à l'arrivée de cette version, démarrer avec une **planche vide** (on n'auto-remplit plus `canvasLayout`). Les positions déjà persistées (éléments réellement draggés par le passé) restent et s'affichent. Pour les packs où tout était implicitement placé, la planche apparaîtra vide → c'est voulu (le constat de départ est « c'est le bordel avec tout »).
- **Bouton « Tout arranger sur la planche »** (dans l'état vide + accessible depuis le panneau) : appelle `gridArrange` sur tous les éléments, écrivant des entrées `canvasLayout` — un clic pour retrouver l'ancien comportement si désiré.
- **Planche vide** → état vide engageant : « Glisse un élément ici, ou ouvre-en un depuis le panneau » + le bouton ci-dessus.
- **Ouverture d'un pack** → mode planche par défaut.

## 9. Mobile (< lg)

- Panneau gauche → **drawer** (pattern `WorkspaceSidebar` déjà en place).
- Centre mono-panneau ; pane de droite → drawer/onglet.
- Bascule **Planche ↔ Vue individuelle** via la navigation (la route enfant gère l'état). Pas d'affordance hover-only — les actions add/remove/delete passent par menu contextuel (long-press) ou boutons visibles.

## 10. Impact code (haut niveau)

| Zone | Changement |
|---|---|
| `editor/src/features/canvas/autoLayout.ts` | Ne plus remplir la grille ; n'émettre que les entrées explicites. Extraire `gridArrange(ids)` pour le bouton « Tout arranger ». |
| `editor/src/features/canvas/Stage.tsx` | Ne mapper que les éléments dans `canvasLayout`. Brancher le rendu des chips fantômes. |
| `editor/src/features/canvas/Edges.tsx` | Edges seulement entre nœuds présents ; déléguer hors-planche aux chips. |
| `editor/src/features/canvas/MenuGroup.tsx` (+ split) | Extraire un cœur de rendu agnostique du contexte (refactor §7). |
| **Nouveau** `WorkspacePanel` | Panneau gauche : catégories, recherche, drag source, badges, menu contextuel, création. |
| **Nouveau** route `…/element/$elementId.tsx` + `ElementView` | Vue individuelle deep-linkable ; dispatch par type ; monte les composants de rendu partagés. |
| **Nouveau** `ActionsChainEditor` partagé (si pas déjà factorisable) | Éditeur de flux commande/dialog réutilisable centré + en pane. |
| `state/accountStore` | `addToBoard` / `removeFromBoard` ; `deleteFromPack` existant. |
| Route overview `…workspaces.$workspaceId.tsx` | Ajouter la zone panneau gauche au layout overview (3 zones desktop : panneau · planche · éditeur). La route enfant existante (`childMatches`/`Outlet`) rend la vue individuelle. |
| Docs | `editor-internals.md` (modèle planche/panneau/vue individuelle, sémantique `canvasLayout`), `entities.md` (sémantique `canvasLayout`). Marquer 2026-06-02 comme superseded. |

## 11. Phasing

Chaque phase shippable sans casser l'existant.

| Phase | Scope | UX visible | Risque |
|---|---|---|---|
| **P1** | Refactor : extraire le cœur de rendu menu agnostique (§7), gardé par tests | Non | Bas (gate tests) |
| **P2** | Modèle d'appartenance : `autoLayout` n'auto-remplit plus + `gridArrange` + `addToBoard`/`removeFromBoard` + migration planche vide + bouton « Tout arranger » | Oui (planche curée) | Moyen (sémantique `canvasLayout`) |
| **P3** | `WorkspacePanel` (liste, recherche, badges, drag→planche, menu contextuel, clic=ouvrir) | Oui | Moyen |
| **P4** | Route `…/element/$elementId` + `ElementView` dispatch + top bar focus + empty state ; vue individuelle **menu** (cœur de rendu solo) | Oui (édition hors-planche pour les menus) | Moyen |
| **P5** | Vue individuelle **commande/dialog** (flux centré, `ActionsChainEditor` partagé) | Oui | Moyen |
| **P6** | Chips fantômes (liens hors-planche cliquables) + double-clic nœud planche → vue individuelle | Oui | Bas |
| **P7** | Mobile : drawers panneau/éditeur, bascule planche↔individuelle, actions sans hover | Oui | Bas |

## 12. Testing

- **Refactor (P1)** : `MenuGroup.test.tsx` passe sans modif de comportement ; tests unitaires sur les helpers de géométrie extraits.
- **Modèle (P2)** : `autoLayout` n'émet que les entrées explicites ; `addToBoard`/`removeFromBoard` muent `canvasLayout` sans toucher au reste du pack ; `removeFromBoard` ≠ `deleteFromPack` (l'élément survit) ; `gridArrange` place tout.
- **Panneau (P3)** : rendu groupé par catégorie, filtre recherche, badge « sur la planche » réactif, clic → navigate vers la route élément, drag → `addToBoard`.
- **Vue individuelle (P4/P5)** : navigation directe par URL, empty state si introuvable, retour fonctionne ; menu rendu solo édite via le **même** chemin que la planche (test anti-divergence : éditer un slot en vue individuelle et sur la planche produit le même mut store) ; commande/dialog flux centré édite/ajoute/réordonne.
- **Chips (P6)** : un lien vers une cible hors-planche rend un chip ; clic = `addToBoard` + edge réel apparaît.
- **Mobile (P7)** : drawers, pas de hover-only, actions accessibles.

## 13. Non-goals (V1)

- **Cross-navigation riche** (reverse links « utilisé par », backstack) — reportée comme dans 2026-06-02 ; les edges + chips suffisent.
- **Preview dialog Minecraft natif** — slot V2 (renderer 1.21+ requis).
- **Plusieurs planches / scènes par pack** — une seule planche par pack en V1.
- **Changement de schéma DB** — `canvasLayout` réutilisé tel quel, seule sa sémantique évolue.
- **Module HUD** — `ElementView` est extensible (ajouter un cas au dispatch) quand le module arrivera.
