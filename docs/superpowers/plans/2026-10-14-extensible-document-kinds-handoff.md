# Handoff — Artisan : Document kinds extensibles

Date: 2026-10-14. État : **conception terminée, docs écrits, aucun code touché.**
ADR `proposed`. Compagnon de `docs/decisions/extensible-document-kinds.md` et de la
spec `docs/superpowers/specs/2026-10-14-extensible-document-kinds-design.md`.

## En une phrase

On a décidé comment permettre à un module Artisan d'ajouter des **Document kinds**
(NPC, Quêtes, Conversations) au même niveau que menus/commands/dialogs, puis on a
grillé les 8 questions de design jusqu'au bout. Prochaine étape = accepter l'ADR et
faire le **refactor « dogfood »** (étape purement mécanique, sans changement de
comportement).

## Où vivent les décisions (ne pas dupliquer ici)

- **ADR** : `docs/decisions/extensible-document-kinds.md` (status **proposed**).
  Contient les **13 décisions** + une table « Décisions tranchées en grill
  (2026-10-14) ». **Lire en premier.**
- **Spec de construction** :
  `docs/superpowers/specs/2026-10-14-extensible-document-kinds-design.md` —
  descripteurs éditeur/plugin, workstreams **W0→W7**, références `file:line` des
  hard-codes à casser, stratégie, validation, risques.
- **Glossaire** : `CONTEXT.md` — termes **Action** et **Conversation** ajoutés ce
  jour ; « un kind de Document » remplace « un des trois kinds ». *NPC* et *Quest*
  restent à définir (avec leur pilote).

## L'essentiel du modèle (résumé — le détail est dans l'ADR)

- Un **Document kind** = contenu authored (dossier + schema + vue éditeur +
  parse/serialize + create/rename + key sites i18n), **enregistré par un module**.
  Les kinds core (menus/commands/dialogs) **dogfoodent** le même registre.
- Une **Action** est une unité invocable (leaf step). Le vocabulaire est
  core-owné mais **extensible** : un module déclare des Actions typées. **Un seul
  système de types** (celui des data models) + **`document_ref(kind)`** = seul type
  neuf → picker + rename + dangling + arête, génériquement.
- Wire = **structureé keyed** (`structured-action-wire`), Action module = clé
  inconnue **tolérée** par le schéma core. `run_command ns:cmd` = échappatoire
  **opaque** (pas de lien).
- **Board** = défauts core + **arêtes dérivées des args `document_ref`** + surcharge
  optionnelle. Un **trigger** = **slot de chaîne nommé** déclaré par un visiteur
  `chainSlots`.
- **NPC** = une entité à une position ; triggers **discrets** (v1 : clic
  droit/gauche) ; **proximité différée**. **Conversation** = kind d'arbre à choix,
  distinct de **Dialog**, ouvert par `open_conversation <ref>`.

## État exact

- Fichiers écrits ce jour : les deux docs ci-dessus + 2 termes dans `CONTEXT.md` +
  ce handoff. **Rien compilé, rien testé, aucun commit.**
- L'ADR est `proposed` — **à passer `accepted`** si on avance.

## Prochaine session — deux options

1. **Accepter l'ADR puis démarrer le refactor dogfood** (recommandé). Ordre :
   - **W2 d'abord** (le plus profond) : `Project.menus/commands/dialogs` et
     `ProjectBundle.menus/commands/dialogs` → **conteneur par kind**. Pur
     déplacement de câblage.
   - **W1** ensuite : codec d'actions piloté par registre ; `open_menu` & co
     deviennent des Actions déclarées.
   - Verrou : `testdata/doc-ref-conformance.json` **doit rester vert et inchangé** ;
     `action-dsl-conformance.json` (+ `menuV1.test`, `menuV1ToDomain.roundtrip`)
     verts. Garde-fou clé : **dir de kind inconnu = opaque préservé** (round-trip,
     jamais supprimé).
   - Tests : `cd plugin && ./gradlew test` ; `cd editor && npm test`.
2. **Griller d'abord le modèle interne d'un pilote** (Conversation = arbre à choix
   / Quest = objectifs+récompenses) avant de coder, si on veut figer un kind
   concret avant la plomberie.

## Suggested skills

- **`grill-with-docs`** — si on choisit l'option 2 (modèles internes des kinds), ou
  pour tout nouvel arbitrage ; met à jour `CONTEXT.md`/ADR inline.
- **`tdd`** — pour le refactor dogfood (tests rouges→verts par workstream).
- **`sync-docs`** — en fin de feature, pour l'audit doc via
  `.agents/skills/sync-docs/doc-impact-map.yaml`.
- **`to-issues`** — pour découper W1→W7 en tickets une fois l'ADR accepté.

## Pièges à ne pas rater (détail dans la spec §W2/§Risques)

- `editor/src/schema/projectFromFiles.ts` `CORE_PREFIXES` (~l.396) : un dir de kind
  non listé est **avalé dans `moduleData.__files`** au lieu d'être parsé.
- Le schéma JSON est **statique** : on ne l'étend **pas** dynamiquement ; on tolère
  les clés d'Action inconnues.
- Deux unions parallèles à consolider : `DocumentKind`
  (`features/canvas/serverGraph.ts:6`) et `DocumentType`
  (`features/project/useProjectDocuments.ts:8`), plus `SearchGroup`.
