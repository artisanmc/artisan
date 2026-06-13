# Assistant IA — support des commandes et dialogs

**Date** : 2026-06-13
**Statut** : en revue

## Problème

L'assistant IA migre les menus (zMenu/DeluxeMenus → `menu/v1`) mais **ne peut ni créer ni éditer les commandes et les dialogs** : il n'a aucun outil pour ça. Conséquence concrète rapportée : une config importée donne des menus « plus ou moins » corrects, mais ses commandes et ses dialogs sont perdus.

État actuel (asymétrie) :

| Couche | Menus | Commandes | Dialogs |
|---|---|---|---|
| Tools (`tools.ts`) | `list/get/upsert/delete_menu` | — | `list_dialogs` (lecture seule) |
| WorkingCopy | menus complets | absent | résumés `{id,title}` |
| Validation (`validate.ts`) | `validateMenuV1` | — | — |
| Grounding | guide menu/v1 | — | — |
| Éditeur (apply) | `applyAssistantMenu` + `menuV1ToDomain` | — | — |
| Flux (`AssistantChat`→`routes`) | menus envoyés | non envoyées | résumés seulement |

Les schémas `command/v1` et `dialog/v1` sont **déjà publiés** (`docs/schema/`), référencent les `$defs/Action` et `$defs/Condition` de `menu/v1`, et le pipeline d'export domaine→wire (`transform.ts`) sait déjà sérialiser commandes et dialogs. Il manque le tour complet côté assistant + l'import wire→domaine côté éditeur.

## Objectif

L'assistant peut **créer, lire, remplacer et supprimer** commandes et dialogs, exactement comme il le fait pour les menus, avec application live sur le canvas et persistance immédiate. Le scope d'actions/conditions reste le sous-ensemble runtime déjà appliqué aux menus (`SUPPORTED_ACTIONS` / `SUPPORTED_CONDITIONS` dans `grounding.ts`).

## Décisions

| Sujet | Décision |
|---|---|
| Périmètre | Commandes **et** dialogs, CRUD complet pour les deux. Miroir exact du pipeline menu. |
| Découpage livraison | Une seule feature (spec + plan unique), exécutée en deux lots de tâches (commandes, puis dialogs) pour des commits cohérents. |
| Vocab actions/conditions | Réutilise `SUPPORTED_ACTIONS` / `SUPPORTED_CONDITIONS` existants. Le walker de vocab (`collectVocabErrors`) est généralisé pour couvrir les `actions`/`requirements`/`fallback` d'une commande et les `actions` des boutons de dialog. |
| Sérialisation pour l'envoi | Exporter `serializeCommand` / `serializeDialog` (aujourd'hui privées dans `transform.ts`) + ajouter `packToCommandV1(pack)` / `packToDialogV1(pack)` (miroir de `packToMenuV1`). |
| Convertisseurs wire→domaine | Nouveaux `commandV1ToDomain.ts` / `dialogV1ToDomain.ts` dans `editor/src/schema/`, réutilisant le convertisseur d'action de `menuV1ToDomain.ts` (extrait dans un module partagé `actionV1ToDomain.ts`). |
| `list_dialogs` | Conservé. La WorkingCopy passe de résumés à dialogs **complets** ; `list_dialogs` continue de renvoyer `{id,title}` (résumé dérivé), `get_dialog` renvoie l'objet complet. |
| i18n | Les commandes/dialogs wire portent du texte littéral / `{i18n:key}` comme les menus. Les convertisseurs réutilisent la même logique d'extraction i18n que `menuV1ToDomain`. |

## Design

### Backend `backend/src/modules/assistant/`

**`validate.ts`** — ajouter :
- `validateCommandV1(cmd)` : ajv contre `command/v1/schema.json` (qui `$ref` les `Action`/`Condition` de menu/v1 — l'ajv instance doit charger le schéma menu/v1 comme schéma référencé) + walker de vocab sur `actions`, `requirements`, `fallback`.
- `validateDialogV1(dlg)` : ajv contre `dialog/v1/schema.json` + walker de vocab sur les `actions` de chaque bouton.
- Généraliser `collectVocabErrors` : extraire les helpers `condition`/`action`/`steps` réutilisables (les commandes utilisent `actions` plat + `requirements` + `fallback` ; les dialogs `buttons[].actions` plat).

**`tools.ts`** — nouveaux `ToolDef` + cases :
- Commandes : `list_commands`, `get_command`, `upsert_command`, `delete_command`.
- Dialogs : `get_dialog`, `upsert_dialog`, `delete_dialog` (`list_dialogs` existe déjà).
- Étendre `EngineEvent` : `command_written`/`command_deleted`/`dialog_written`/`dialog_deleted`.

**`workingCopy.ts`** — ajouter maps `commands` et `dialogs` (objets complets, pas résumés). `listDialogs()` dérive le résumé `{id,title}`. Constructeur étendu : `(menus, attachments, dialogs, commands)`.

**`grounding.ts`** + 2 fiches :
- `grounding/command-v1-authoring-guide.md`, `grounding/dialog-v1-authoring-guide.md`.
- `buildSystemPrompt` les inclut. Anti-injection : mentionner que commandes et dialogs se produisent aussi exclusivement via tools.

**`routes.ts`** — le body de `POST .../messages` reçoit `commands` (objets command/v1 complets) ; `dialogs` passe de résumés à objets dialog/v1 complets. WorkingCopy reconstruite avec les 4 collections.

### Éditeur `editor/src/`

**`schema/actionV1ToDomain.ts`** (nouveau) — extraire le convertisseur d'action wire→domaine actuellement interne à `menuV1ToDomain.ts` (`action(a)`), pour le partager. `menuV1ToDomain` l'importe (refactor sans changement de comportement, couvert par ses tests existants).

**`schema/commandV1ToDomain.ts`** (nouveau) — `commandV1ToDomain(cmd, {packId, lang})` → `{ command: Command, i18nKeys, unsupported }`. Mappe `actions: Action[]` wire → `steps: Step[]` domaine (chaque action wrappée `{kind:"action", action}`) ; `arguments` → `CommandArg[]` ; extrait i18n des textes.

**`schema/dialogV1ToDomain.ts`** (nouveau) — `dialogV1ToDomain(dlg, {packId, lang})` → `{ dialog: Dialog, i18nKeys, unsupported }`. Mappe `body`/`inputs`/`buttons` ; `buttons[].actions` → `steps`.

**`state/accountStore.ts`** — `applyAssistantCommand` / `applyAssistantDialog` (miroir de `applyAssistantMenu` : convertit, merge i18n, insert/replace, `updatedAt`). Retournent les `unsupported`.

**`features/export/transform.ts`** — exporter `serializeCommand` / `serializeDialog` + ajouter `packToCommandV1(pack)` / `packToDialogV1(pack)`.

**`features/assistant/AssistantChat.tsx`** — collecter et envoyer `commands` (via `packToCommandV1`) + dialogs complets (via `packToDialogV1`, remplace les résumés). Gérer les 4 nouveaux events (apply + carte UI + `dirty`). Réutiliser le même toast `unsupportedDropped`.

**`lib/api/assistant.ts`** — `streamAssistant` body : ajouter `commands?`, élargir `dialogs?` au type objet complet.

## Hors scope

- Templates, data sources, assets (l'assistant ne les touche pas).
- Édition fine multi-tour des steps `if` dans les commandes au-delà de ce que le vocab permet déjà.
- Modèle conversationnel / provider (inchangé).
- Nouveaux types d'action/condition (le sous-ensemble runtime reste figé).

## Tests

- **Backend** : `validate.test.ts` (command/dialog valides + rejets de vocab + champs non supportés) ; `tools.test.ts` (chaque nouveau tool : succès, id manquant, validation échec → message d'erreur, events émis) ; `workingCopy` (commands/dialogs CRUD, `listDialogs` dérive le résumé).
- **Éditeur** : `commandV1ToDomain.test.ts` + `dialogV1ToDomain.test.ts` (round-trip via `serializeCommand`/`serializeDialog`, extraction i18n, unsupported) ; `accountStore.test.ts` (`applyAssistantCommand`/`applyAssistantDialog` insert+replace+i18n) ; `transform` (packToCommandV1/packToDialogV1) ; `AssistantChat.test.tsx` (events command/dialog → apply appelé).
- Suites complètes vertes des deux côtés (`bun run test`, `npm test`).

## Docs à mettre à jour

- `CHANGELOG.md` `[Unreleased]` (surface assistant + tools).
- `docs-site` — page assistant si elle décrit les capacités (à vérifier ; sinon note dans la doc assistant existante).
- Les 2 fiches de grounding sont des artefacts produits, pas de la doc à synchroniser.
