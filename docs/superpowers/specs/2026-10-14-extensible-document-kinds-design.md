# Document kinds extensibles — design & découpage

**Status:** draft (2026-10-14) — dérive de l'ADR `extensible-document-kinds`.
Décisions de la grill (2026-10-14) intégrées ; matière brute pour la construction.

## But

Permettre à un module d'ajouter des **Document kinds** au même niveau que
menus/commands/dialogs, chacun pouvant apporter : son **contenu** (fichiers,
schéma, vue éditeur, i18n), des **Actions** (`start_quest`, `open_conversation`)
et des **sources de déclenchement** (interactions d'un NPC, branches d'une
Conversation).

## Non-buts

- Réintroduire le DSL (éliminé par `structured-action-wire`).
- Un « kind en data » sans module.
- **Proximité / zones** : état continu, mécanisme distinct — différé (grill Q8).
- Le **modèle interne** d'une Quête / d'une Conversation (objectifs, récompenses,
  nœuds) : grillé avec le pilote, pas ici.

## Le modèle

### Descripteur côté éditeur (`FrontendModule.documents?`)

Ajout au contrat `FrontendModule` (`editor/packages/editor-sdk/src/contract/types.ts:14-43`),
exporté par le barrel `editor/packages/editor-sdk/src/index.ts` :

```ts
interface DocumentKindContribution {
  kind: string;                    // "npc", "quest", "conversation"
  dir: string;                     // "npcs/", "quests/"
  schemaVersion: string;           // "npc/v1"
  label: { en: string; fr: string } | string; // i18n key
  icon: ComponentType;
  idPrefix: string;                // "npc_", "quest_"
  component: ComponentType;        // la vue d'édition du kind
  create(seed?): Document;         // minting + seed
  relPath(id: string): string;     // dir/<id>.yaml
  parse(file, ctx): Document;      // fichier → domaine
  serialize(doc, ctx): string;     // domaine → fichier
  ltextSites(doc): LTextSite[];    // key sites i18n (rekey + GC)
  chainSlots(doc): ChainSlot[];    // où vivent les chaînes (cf. trigger)
  actions?: ActionDecl[];          // Actions déclarées (typées)
  board?: { size?; render?; rank? }; // surcharge board — OPTIONNELLE
}

// Une Action déclarée : un nom + des arguments typés (système de types partagé,
// + le seul type neuf `document_ref(kind)`). `document_ref` fait de l'argument
// une cible résolue → picker + arête, génériquement (aucun code de board).
interface ActionDecl {
  name: string;                    // "start_quest", "open_conversation"
  args: ArgDecl[];                 // types field kit + document_ref(kind)
}

// Un trigger EST un slot de chaîne nommé qui est un point d'entrée.
interface ChainSlot { name: string; /* "right_click", "invoke", "click" */ }
```

Les kinds core (menus, commands, dialogs) déclarent les leurs via ce même
contrat → **dogfood**.

### Descripteur côté plugin (nouvelle surface `@Beta`)

Nouveau `DocumentKindRegistry` dans `plugin/api`, calqué sur `ModelRegistry`
(`plugin/api/.../modules/api/ModelRegistry.kt`) et `EditorScreenRegistry` :

```kotlin
api.documents.declare(DocumentKindDeclaration(
    kind = "npc",
    dir = "npcs",
    schemaVersion = "npc/v1",
    acceptedVersions = listOf("npc/v1"),
    parse = { text, ctx -> ... },                 // fichier → document runtime
    actions = listOf(ActionDecl("npcs:spawn") { player, args -> ... }),
    chainSlots = listOf("right_click", "left_click"),
))
```

Rapporté au `hello` /`modules_changed` sous `document_kinds` (parallèle de
`declared_models`, `editor_screens`).

## Stratégie : généraliser d'abord, ouvrir ensuite, prouver au bout

L'ordre est non négociable : **le refactor dogfood est un pur déplacement de
câblage, verrouillé par les vecteurs existants**. On n'ouvre l'enregistrement
qu'une fois les kinds core passés par le registre sans changement de
comportement.

## Workstreams

### W0 — ADR + spec (ce document)

ADR `extensible-document-kinds` (proposed) + cette spec. Les questions de l'ADR
sont tranchées en grill (table « Décisions tranchées » de l'ADR).

### W1 — Actions : types, vocabulaire, wire (les deux stacks + schéma)

- **Un seul système de types** : le schéma d'arguments réutilise le vocabulaire de
  `composable-data-models` (field kit : `material`, `item`, `minimessage`,
  `actions`, `enum`, `list`, `object`…) **plus** `document_ref(kind)` — le seul
  type neuf, source générique des arêtes.
- Wire : les noms d'Actions core restent énumérés dans
  `docs/schema/menu/v1/schema.json` `$defs.Action` (1014+, validation **stricte**) ;
  ajouter la **tolérance map-à-clé-inconnue** (Action module, validée au form).
- Éditeur : `editor/src/schema/actionV1ToDomain.ts:29-48` (`action()` switch
  `default → pushUnsupported`), `features/flow/defaults.ts:63-86` (`ACTION_TYPES`),
  `docs/schema/menu/v1/types.ts:397-420`, labels/pickers `features/flow/labels.ts:6,44`.
- **Dogfood** : `open_menu`/`open_dialog`/`close_menu`/`open_previous_menu`
  deviennent des Actions **déclarées** (menus/dialogs) ; codec piloté par registre.
- Si `structured-action-wire` est accepté entre-temps : le codec DSL
  (`editor/src/lib/actionDsl/*`, `plugin/core/.../actiondsl/*`) est retiré ; sinon
  garder `parseVerb` **piloté par table** (ADR `action-dsl` §Portability).
- Vecteurs : `testdata/action-dsl-conformance.json` (ou successeur) gagne un
  fixture d'Action module keyed.

### W2 — Modèle Project (des deux côtés)

- Éditeur : `editor/src/domain/types.ts:134-164` — `Project.menus/commands/
  dialogs` → conteneur par kind. Impacte `schema/projectFromFiles.ts:396-533`
  (`CORE_PREFIXES` + les trois blocs de parse), `features/export/transform.ts:1095-1241`.
- Plugin : `ProjectBundle.kt:538-557` → conteneur ; `ProjectReader.kt:170-215`
  (trois blocs → un scan par kind enregistré), `withFileId` (`:71-91`) devient un
  hook du kind.
- **Opaque préservé** : un dir de kind non enregistré round-trip dans
  `moduleData.__files` (aujourd'hui implicite — le rendre explicite et testé).

### W3 — Ref resolution + runtime « faire »

- Réutiliser `DocumentTable<T>` : `SyncedMenuProvider.kt:84-100` devient un
  `Map<kind, DocumentTable>` ; `resolveRef` (`:102-116`) déjà kind-paramétré.
- Runtime : `provider/MenuProvider.kt:15-28` → un dispatch par Action kind-
  enregistrée ; `engine/ActionExecutor.kt:132-166,326-340` → dispatch registre ;
  `engine/NavigationHistoryStore.kt` `Kind` enum → string.
- `testdata/doc-ref-conformance.json` **inchangé** (algorithme kind-agnostique).

### W4 — Board / canvas

- `features/canvas/serverGraph.ts:6,54-116` : `DocumentKind` union → `string` +
  registre ; `addTarget` pour les kinds cibles.
- **Arêtes génériques** : `deriveEdges.ts:17-105` n'a plus d'extracteurs par kind —
  on scanne les chaînes (via `chainSlots`) et on émet une arête pour **tout
  argument `document_ref`**. C'est `document_ref` (W1) qui fait le travail.
- **Défauts + surcharge** : nœud générique (boîte + label + taille) et rang de
  gutter par défaut ; `board?` du kind surcharge. `arrangeBoard.ts:43`
  `GUTTER_KIND_ORDER`, `menuLayout.ts:4,60`, `ServerCanvasPage.tsx:33,177-186,399-430`
  → registre.
- Piège cosmétique : nœuds/frames synthétiques forcés `kind: "menu"`
  (`arrangeBoard.ts:800-807`, `groupedBoard.ts:45-61,110-189`) — kind neutre.

### W5 — Listing / create / rename / delete / i18n

- Éditeur : `useProjectDocuments.ts:8-41`, `ProjectDocumentTree.tsx:24-113`,
  `ProjectSidebar.tsx:274-280` (`documentCount`), `searchIndex.ts:6,155`,
  `domain/canvasGroups.ts:4-8` (`liveDocumentIds`).
- `state/accountStore.ts` : `createMenu/createCommand/createDialog` (`:1467-1539`),
  `setMenuId/setCommandId/setDialogId` (`:2665-2745,1562-1601`),
  `deleteFromProject` (`:4082-4113`), `rekeyProject` (`:4248-4258`) → hooks du
  kind.
- i18n : `lib/i18nKeys.ts:5-49`, `domain/i18nSites.ts:158-207,544` — le visiteur
  `ltextSites` du kind (sinon rekey/GC silencieusement cassés) ; `chainSlots` sert
  aussi au rename des refs dans les chaînes.
- `domain/ids.ts:28-31` + dialogues `New*Dialog.tsx` → minting par kind.

### W6 — Surfaces d'enregistrement

- Plugin : `api.documents.declare(...)` (`DocumentKindRegistry`), hooks
  `ArtisanModule`, `ArtisanPlugin.defaultModules()` (`:94-96`) dogfood.
- Éditeur : `FrontendModule.documents`, collection dans
  `editor/packages/editor-sdk/src/contract/registry.ts:6-32`, dogfood dans
  `editor/src/modules/menus/index.ts` / `commands/index.ts` + dialogs enregistré
  dans `main.tsx:9-24`.
- Presence : `document_kinds` au `hello`.

### W7 — Kinds pilotes

Dans l'ordre de moindre risque, en add-on, de bout en bout — la validation :

1. **Conversation** — kind d'**arbre à choix** (branches gardées par conditions),
   cible `open_conversation` ; valide la navigation, les arêtes, le visiteur de
   chaînes. Distinct de `Dialog`.
2. **Quest** — kind + Actions de domaine (`start_quest`, `complete_quest`) ;
   valide les Actions déclarées typées et les arêtes vers un non-écran.
3. **NPC** — **entité à une position**, triggers **discrets** (`right_click`,
   `left_click`) ouvrant p.ex. une Conversation ; valide la source de
   déclenchement. **Proximité différée.**

Chaque pilote tranche le **modèle interne** de son kind (objectifs, nœuds, etc.).

## Validation

- Vecteurs existants **intacts** après W1–W5 (pur refactor) :
  `action-dsl-conformance.json` (ou successeur), `doc-ref-conformance.json`,
  `menuV1.test`, `menuV1ToDomain.roundtrip`.
- Nouveaux tests : round-trip d'un dir de kind inconnu (opaque préservé) ; une
  Action module keyed → arête dérivée du `document_ref` ; résolution d'une ref de
  kind module ; exécution d'une Action déclarée.
- `./gradlew test` (plugin) + `npm test` (éditeur) verts à chaque workstream.

## Risques

- **Churn immense sur `Project`/`ProjectBundle`** (W2) : le plus profond. À faire
  en premier, derrière les vecteurs, avant toute ouverture d'API.
- **Schéma wire statique** : résolu par la tolérance map-à-clé-inconnue (W1) —
  vérifier que `validateMenuV1` reste strict sur les Actions core.
- **Module désinstallé** : le test « opaque préservé » est le garde-fou.
- **Inflation SemVer** : ne figer que le descripteur `@Beta`.

## Décisions tranchées (grill 2026-10-14)

Voir la table homonyme de l'ADR `extensible-document-kinds` : Actions keyed
déclarées + `document_ref(kind)` seul type neuf ; core dogfood ; `open_menu` non
spécial ; NPC = entité à une position ; Conversation ≠ Dialog (arbre à choix) ;
board = défauts + arêtes dérivées des types ; chaînes déclarées par visiteur ;
proximité non-trigger (différée).
