# Document kinds extensibles — design & découpage

**Status:** draft (2026-10-14, rafraîchi le 2026-10-15) — dérive de l'ADR
`extensible-document-kinds`. Décisions de la grill (2026-10-14) intégrées ; matière brute pour
la construction. Le 2026-10-15 la carte `file:line` a été confrontée au code de `v2` (après
#48–#54) ; les questions R1–R5 de l'ADR (§Révision) sont **ouvertes** et marquées ici.

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
  chainSlots(doc): ChainSlotSite[]; // où vivent les chaînes (cf. trigger)
  actions?: ActionDecl[];          // Actions déclarées (typées)
  board?: { size?; render?; rank? }; // surcharge board — OPTIONNELLE
}

// Une Action déclarée : un nom + des arguments typés. R3 (ADR) : les args sont des
// `ModelField[]` du field kit existant (`ModelFieldType`), `document_ref(kind)` étant
// un kind de `ModelFieldType` ajouté — pas un vocabulaire d'arguments à part. C'est
// `document_ref` qui fait de l'argument une cible résolue → picker + arête,
// génériquement (aucun code de board), y compris depuis une ligne de data model.
interface ActionDecl {
  name: string;                    // "start_quest", "open_conversation"
  args: ModelField[];              // field kit + { kind: "document_ref", of: kind }
}

// Un trigger EST un slot de chaîne nommé qui est un point d'entrée. Le visiteur
// rend des SITES (comme `LTextSite`) : l'extracteur générique d'arêtes a besoin des
// steps et du chemin pour garder les triggers que la planche affiche (élément +
// clickType, bouton de dialog, invocation de commande…).
interface ChainSlotSite {
  name: string;                    // "right_click", "invoke", "click"
  steps: Step[];
  path: string;                    // chemin dans le document, pour le rename/undo
  label?: string;                  // ce que l'arête affiche (material, bouton…)
}
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

Ordre des lots (2026-10-15, après R1 et R2) : le **conteneur (W2) d'abord**, c'est la base ;
puis le **registre d'actions avec dispatch par handler (W1 + W3)** ; puis **`document_ref`
dans `ModelFieldType` et les arêtes génériques (W4)** ; puis listing/create/rename/i18n (W5) ;
puis les surfaces d'enregistrement publiques et la présence (W6, `@Beta`) ; enfin un pilote (W7)
avant tout gel d'API.

## Workstreams

### W0 — ADR + spec (ce document)

ADR `extensible-document-kinds` (proposed) + cette spec. Les questions de l'ADR
sont tranchées en grill (table « Décisions tranchées » de l'ADR).

### W1 — Actions : types, vocabulaire, wire (les deux stacks + schéma)

- **Un seul système de types** : le schéma d'arguments réutilise le field kit réel
  (`ModelFieldType`, `editor/src/domain/types.ts` : `string, number, integer, boolean,
  ltext, minimessage, minimessage_multiline, item, actions, conditions, list, object, model,
  map, enum, union`) **plus** `document_ref(kind)` — le seul type neuf, source générique
  des arêtes. R3 : l'ajouter **à** `ModelFieldType`, pas à côté.
- Wire : les noms d'Actions core restent énumérés dans
  `docs/schema/menu/v1/schema.json` `$defs.Action` (l.975+, validation **stricte**) ;
  ajouter la **tolérance map-à-clé-inconnue** (Action module, validée au form).
  **État réel (2026-10-15)** : l'éditeur transforme aujourd'hui une clé inconnue en
  `run_actions ""` (`structuredSteps.ts` `decodeAction` default — perte silencieuse) et le
  plugin lève `IllegalArgumentException("Unknown action")` (`KeyedStepParser.parseAction`
  else). Les deux doivent devenir le passthrough `module(name, args)`.
- Éditeur : `editor/src/schema/actionV1ToDomain.ts:29-48` (`action()` switch
  `default → pushUnsupported`), `features/flow/defaults.ts:63-86` (`ACTION_TYPES`),
  `docs/schema/menu/v1/types.ts:397-420`, labels/pickers `features/flow/labels.ts:6,44`.
- **Dogfood** : `open_menu`/`open_dialog`/`close_menu`/`open_previous_menu`
  sont des **handlers** du module menus/dialogs (R1 tranché : `ActionHandler { name,
  args: ModelField[], primary?, execute(ctx, args, runtime): ctx }`) ; codec, form, picker,
  arêtes **et dispatch** pilotés par registre, sealed class `Action` interne au module. Test
  de complétude : un handler par nom du vocabulaire, schéma coïncidant. Verrou supplémentaire :
  `i18n-address-conformance.json` — le visiteur i18n des args devient piloté par schéma
  (`ltext` dans `ModelField[]`, comme `visitModelValueLTexts`) et doit émettre les **mêmes
  adresses** que `visitStepLTexts` / `I18nAddresses.kt` pour les actions core.
- `structured-action-wire` est **accepted** (2026-10-15) : le wire keyed est en prod des
  deux côtés. Le codec DSL (`editor/src/lib/actionDsl/*`, `plugin/core/.../actiondsl/*`)
  ne sert plus qu'à lire les anciens fichiers ; son retrait est un nettoyage séparé.
- Vecteur : `testdata/action-wire-conformance.json` (créé le 2026-10-15,
  `ActionWireConformanceTest` ↔ `lib/actions/actionWireConformance.test.ts`) verrouille
  le wire keyed ; il gagne un fixture d'Action module (clé inconnue → passthrough) avec le
  lot qui l'implémente.

### W2 — Modèle Project (des deux côtés)

R2 tranché (2026-10-15) : **conteneur unique, maintenant, entier**. `project.documents[kind]`
(éditeur) et `ProjectBundle.documents` (plugin) sont la seule source de vérité ; les champs
`menus/commands/dialogs` disparaissent. `documentsOf(project, kind)` et des accesseurs typés par
kind (`menusOf(project)`…) sont une **façade de lecture** pour l'ergonomie, jamais un second
stockage. Les ~98 fichiers de l'éditeur qui lisent `project.menus` (130 occurrences hors tests,
`.dialogs` 36, `.commands` 39) passent tous par la façade dans ce workstream — le volume n'est
pas un argument, c'est le périmètre. Un minimum de registre de kinds (kind → `dir`, `idPrefix`,
`schemaVersion`) est nécessaire ici pour piloter `CORE_PREFIXES`, `ProjectReader` et
`ResourceInventory` par les données ; les descripteurs complets (W6) viennent après.

- Éditeur : `editor/src/domain/types.ts:134-164` — `Project.menus/commands/
  dialogs`. Impacte `schema/projectFromFiles.ts:396-533`
  (`CORE_PREFIXES` + les trois blocs de parse), `features/export/transform.ts:1095-1241`.
- Plugin : `ProjectBundle.kt:538-557` ; `ProjectReader.kt:170-215`
  (trois blocs → un scan par kind enregistré), `withFileId` (`:71-91`) devient un
  hook du kind ; `project/ResourceInventory.kt:31` (`listOf("menus", "dialogs", "commands")`).
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
- Store (découpé par #46 part 2) : `state/account/menusSlice.ts` (`createMenu`,
  `setMenuId`), `dialogsSlice.ts` (`createDialog`, `setDialogId`), `commandsSlice.ts`
  (`createCommand`, `setCommandId`), `projectsSlice.ts` (`deleteFromProject`), `i18nSlice.ts`
  (`rekeyProject`) → un slice générique « documents » (create/rename/delete/layout par kind
  via le registre), les slices de kind gardant leurs actions d'édition propres. R5 : à
  coordonner avec les lots restants de #46.
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
- Presence : `document_kinds` au `hello` et `modules_changed` (`WsClient.kt`,
  `SyncedMenuProvider.kt` côté serveur) **et** dans la liste des champs que le hub recopie
  d'une feuille (`plugin/hub/.../RemoteServer.kt`, `modules_changed`) — sinon un kind déclaré
  sur une feuille est invisible depuis le hub.

### W7 — Kinds pilotes

R4 (ouvert) : le kind `quest` est déclaré par MSQuests en add-on (recommandé, c'est la lettre
de l'ADR), donc ce pilote vit dans son dépôt. Note sur l'ordre : Conversation teste navigation et
arêtes mais son éditeur (arbre) est la plus grosse surface UI ; NPC teste le trigger-source avec
un formulaire trivial mais son runtime (entité, interaction) est du vrai travail Bukkit. Une
« Conversation v0 » linéaire (liste de nœuds à choix, sans éditeur graphique) suffit à valider
la plomberie.

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
  `action-wire-conformance.json`, `action-dsl-conformance.json`, `doc-ref-conformance.json`,
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
