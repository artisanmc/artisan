# Artisan — Editor shell scaffold (v0) — ⚠️ HISTORIQUE / SUPERSEDED

> **Ce document décrit le scaffold v0 de l'éditeur (2026-04-30 → 2026-05-05). La quasi-totalité
> de ses décisions a depuis été abandonnée ou remplacée.** Il est conservé comme trace de la
> conception initiale, pas comme référence courante. Ne pas s'y fier pour comprendre l'éditeur
> d'aujourd'hui.
>
> **Sources de vérité actuelles :**
> - Architecture & internals éditeur → [`../architecture/editor-internals.md`](../architecture/editor-internals.md)
> - Glossaire domaine → [`../../CONTEXT.md`](../../CONTEXT.md)
> - Modèle d'état (backend-authoritative + broadcast) → [`../decisions/editor-state-model.md`](../decisions/editor-state-model.md)
> - Choix de stack (Konva, etc.) → [`../decisions/stack.md`](../decisions/stack.md)

---

## Ce que le v0 proposait → ce qui a réellement shippé

| Décision v0 (ce document) | Statut | Réalité actuelle |
|---|---|---|
| **Shell à 3 niveaux** : Account home (grille de packs) → Pack canvas (graphe) → Menu editor | ❌ Abandonné | **Un seul shell** : `ProjectSidebar` + **un canvas Konva** (planche curée) + `EditorPane`. Route canonique `/networks/$networkId/servers/$serverId/projects/$projectId` avec onglets `?tab=` (overview / translations / data-sources / history) + vue Document deep-linkable `…/document.$documentId`. |
| **Canvas React Flow** (niveau 2) | ❌ Remplacé | **Konva** (cf. `stack.md`). Le canvas est une **planche curée** : `project.canvasLayout[id]` = appartenance, pas auto-grille. |
| **1 canvas = 1 pack**, packs comme entités séparées navigables | ❌ Abandonné | Le canvas affiche les Documents d'**un** project ; pas de niveau « grille de packs » au-dessus. La sidebar liste les projects par serveur. |
| **Invariant « Pack hermétique »** (pas de refs cross-pack, validateur enforced) | ❌ **Retiré le 2026-05-02** | Aucune vérification hermétique : les refs peuvent pendouiller ou traverser ; le runtime gère les cibles manquantes (`assertPackHermetic` + call sites supprimés). |
| **i18n scoped au pack**, merge cross-pack annulé | ⚠️ Évolué | i18n porté par le Project (`project.i18nKeys`, refs `LText`), fallback chain ; cf. `editor-internals.md` + glossaire (Key site / LText). |
| **Scaffold v0 = frontend pur** (state in-memory + localStorage + mocks, pas de backend/WS/auth) | ❌ Dépassé | **v1 backend-authoritative** : Bun + Hono + PostgreSQL, broadcast WS, auth (Discord/email/session). Les stores Zustand subsistent mais leur source de vérité est le backend, pas localStorage. |
| Renommage `SlotData` → `Element` | ✅ Tenu (et précisé) | Le **slot de menu** reste `Element`. L'umbrella project-level `element` (vues/route) est devenu **Document** (glossaire) ; `pack`/`Workspace` → **Project**. |
| Stores `useAccountStore` / `usePackCanvasStore` / `useMenuDraftStore` | ⚠️ Refondu | `accountStore`, `uiStore`, `useSelectionStore`, etc. (cf. `editor-internals.md`). Plus de store « par packId/menuId » instancié ; sélection unifiée via `useSelectionStore`. |
| DnD `@dnd-kit` (niveaux 1 & 3) + drag-out « move-to-pack » | ❌ Abandonné | Interactions canvas en Konva (modes select/hand, marquee, guides d'alignement) ; l'ajout/retrait planche se fait par **bouton toggle** dans `ProjectPanel`, pas en drag. |
| Répertoire `web/` | ✅ Renommé | `editor/`. |

---

## Pourquoi conserver ce document

Le v0 a posé des intuitions encore visibles dans le produit (canvas spatial type Figma, édition d'un menu en grille de slots + panneau de propriétés, undo/redo local, theme dark + tokens). Il documente aussi le **point de départ** d'où l'architecture a divergé : utile pour comprendre *pourquoi* certaines choses ont été revertées (le focus mode forké, l'hermétisme, le multi-niveaux) plutôt que jamais tentées.

L'historique détaillé des refontes successives de l'éditeur (focus mode 2026-06-02 reverté, planche curée 2026-06-13, modes & alignement 2026-06-14, recherche Cmd+K) vit dans `editor-internals.md` et dans `docs/superpowers/specs/`.

---

## Réconciliations de specs issues du v0 — suivi

Le v0 listait 10 incohérences à retraiter. État au 2026-06-19 :

1. **Multi-admin lock vs broadcast** — ✅ résolu : l'ADR `editor-state-model.md` (backend-authoritative + broadcast + présence) fait foi ; plus de soft-lock/Take Over.
2. **Persistance du draft** — ✅ résolu : backend autorité, browser optimistic.
3. **Workspace vs serveur** — ✅ résolu : le sélecteur de serveur scope la cible WS/publish, la liste de projects est filtrée par serveur actif (`ServerSelector`).
4. **Plugins tiers visibles par serveur** — ⚠️ partiel : activation par **Presence** (`installed_modules` → `server_modules` → éditeur), cf. glossaire (Presence) + `project_build_layout_monorepo`.
5. **Pack hermétique** — ✅ résolu : annulé, hermétisme retiré.
6. **i18n par pack** — ⚠️ évolué : i18n au niveau Project (cf. ci-dessus).
7. **Vocabulaire `slot` vs `Element`** — ✅ résolu : domain = Element (slot de menu) ; Document = umbrella project-level.
8. **Versions Node** — ✅ aligné sur `stack.md`.
9. **Taxonomie des mutations WS** — couverte par l'ADR état + `ws-protocol.md`.
10. **Onboarding `shop_demo`** — hors périmètre actuel.
