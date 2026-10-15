# Document kinds extensibles — kinds de module, avec actions et sources de déclenchement

**Status:** proposed (2026-10-14) — décisions de grill intégrées.

## Contexte

Aujourd'hui un **Document** est une union **fermée** de trois kinds — Menu, Command,
Dialog — câblée en dur à travers toute la stack :

- éditeur : `DocumentKind = "menu" | "command" | "dialog"`
  (`editor/src/features/canvas/serverGraph.ts:6`), un `DocumentType` qui duplique
  l'union (`editor/src/features/project/useProjectDocuments.ts:8`), un
  `SearchGroup` qui la duplique encore, des listes `KINDS` répétées
  (`ServerCanvasPage.tsx:33`, `boardFilter.ts:14`), un ordre `GUTTER_KIND_ORDER`
  (`arrangeBoard.ts:43`), et un `Project` à trois champs `menus/commands/dialogs`
  (`editor/src/domain/types.ts:134`) ;
- plugin : un `ProjectBundle` à trois champs (`ProjectBundle.kt:538`), trois blocs
  de parse séparés dans `ProjectReader.kt:170-215`, deux `DocumentTable`
  (`menuTable`/`dialogTable`, `SyncedMenuProvider.kt:84-100`) ;
- wire : `docs/schema/menu/v1/schema.json` `$defs.Action` énumère les actions core.

Un module peut déjà déclarer des **data sources**, **commands**, **data models**,
**config screens**, son **project root**, des **placeholders** — mais **pas** un
Document kind. On veut pouvoir ajouter des kinds au même niveau que
menus/commands/dialogs : **NPC**, **Quêtes**, **Conversations**.

**Le constat du grill (2026-10-14) — le prisme « kind navigable via `open_*` » est
faux.** Un Document kind apporte trois choses **indépendantes** :

1. **son contenu** — un dossier disque, un schéma versionné, une surface éditeur,
   des key sites i18n, une création/renommage ;
2. des **Actions** — des unités invocables depuis une Action chain. Toutes ne sont
   pas des `open_*` : une **Quête** se `start_quest`, se `complete_quest` ; une
   **Conversation** s'`open_conversation` ; un **NPC** se `spawn_npc`. `open_menu`
   n'est qu'**une** Action d'une famille plus large ;
3. des **sources de déclenchement** — un kind peut être un **hébergeur de
   chaînes** : un NPC qui réagit au clic droit, une Conversation dont les choix
   pointent ailleurs. C'est ce qui en fait un **nœud-source** sur la planche,
   comme une Command invoquée ou un Element cliqué.

Trois ADR cadrent :

- `structured-action-wire` (proposed) : la sérialisation canonique d'une chaîne est
  **structurée keyed par nom** (`- send_message: "…"`, `- open_menu: {…}`), le DSL
  est **éliminé**. Une Action module est donc **une nouvelle clé** dans une map —
  l'extension est naturelle, pas de grammaire à étendre.
- `action-dsl` §Portability prescrit déjà `parseVerb` **piloté par table**
  (« universal core + host-registered verbs »).
- `composable-data-models` §6 (et le non-exemple « Data model » de CONTEXT) : un
  Module ne déclarait **aucune** variante comportementale, le comportement module
  passait *uniquement* par le bridge `run_command ns:cmd`. Cet ADR **révise** cette
  position pour les Actions (voir Décision 2/3), le bridge restant pour l'ad-hoc.

## Décision

1. **Un Document kind est un contenu authored, enregistré par un module — le core
   dogfood.** Un kind = dossier + `schemaVersion` + vue éditeur + parse/serialize
   + création/renommage + key sites i18n. Les kinds livrés (menus, commands,
   dialogs) deviennent les **premiers inscrits** de la même interface, comme le
   barrel SDK a été adopté par les modules core. Kinds visés : Menu, Command,
   Dialog, **Conversation**, **NPC**, **Quest**.

2. **Une Action est extensible par les modules, à sémantique core.** Le vocabulaire
   reste **sémantiquement core** (`give_item`, `send_message`, `if`/conditions,
   `open_menu`…). Un module **déclare** des Actions namespacées (`quests:start`,
   `npcs:spawn`), chacune avec un **schéma d'arguments typés**. `start_quest` et
   `quests:start` peuvent être la même chose : une Action déclarée, dispatchée au
   handler du module.

3. **Un seul système de types ; `document_ref(kind)` est le seul type d'argument
   neuf.** Le schéma d'arguments d'une Action réutilise le vocabulaire de types des
   data models (`material`, `item`, `minimessage`, `actions`, `enum`, `list`,
   `object`… — le field kit de `captured-items-and-module-field-kit`), plus **un**
   type nouveau : `document_ref(kind)`. C'est lui qui fait d'un argument une **cible
   résolue** — picker, rename, détection de ref morte, cross-projet, **arête**.
   CONTEXT dit déjà « There is **one** type system » (entrée *Data model*) : on ne
   crée pas un second vocabulaire pour les actions.

4. **Les actions core dogfoodent le registre.** `open_menu`, `open_dialog`,
   `close_menu`, `open_previous_menu`… sont des **Actions déclarées** des modules
   menus/dialogs, même contrat que `start_quest`. Le codec, la planche et le
   dispatch deviennent **pilotés par registre** — pas de « si c'est core, c'est
   spécial dans le vocabulaire ». Leur sémantique de handler (push d'historique,
   `clearContext`, `with k=v`) reste du code core : c'est du **handler**, pas une
   forme d'argument.

5. **Wire keyed + tolérance asymétrique.** Les noms d'Actions livrés dans le core
   sont énumérés dans `$defs.Action` (validation **stricte**) ; une Action module
   est acceptée comme **map à clé inconnue** (passthrough, **tolérée** au schéma) et
   validée *au formulaire* par son schéma d'arguments déclaré — cohérent avec
   `composable-data-models` (bloquant dans le form, tolérant au runtime). Aucun
   schéma JSON dynamique.

6. **`run_command ns:cmd` reste l'échappatoire opaque — hors graphe.** La commande
   brute n'a pas d'argument typé : l'éditeur ne la résout pas, ne dessine pas
   d'arête, ne réécrit pas ses ids au rename. Accepté explicitement (grill) : qui
   écrit `run_command quests:start mq_01` n'obtient pas le lien.

7. **Résolution de refs : l'acquis est réutilisé.** `resolveDocRef`
   (`editor/src/domain/docRef.ts`) et `DocumentTable<T>` (plugin) sont **déjà
   génériques** et verrouillés par `testdata/doc-ref-conformance.json`. Un kind
   cible **s'inscrit** ; l'algorithme et le vecteur **ne changent pas** (résolution
   kind-agnostique). `SyncedMenuProvider` tient un `Map<kind, DocumentTable>`.

8. **Sources de déclenchement = slots de chaînes nommés.** Un kind déclare ses
   **slots de chaînes** par un **visiteur** (même forme que les visiteurs
   `ltextSites`/`visit*LTexts` existants — un chemin déclaratif plat ne capte pas
   les collections imbriquées du menu). Un **trigger** est un slot de chaîne nommé
   qui est un **point d'entrée** : `right_click`/`left_click` pour un NPC, `invoke`
   pour un Command, `click` pour un Element. La planche en dérive un nœud-source.

9. **Board = défauts core + arêtes dérivées des types.** Le core fournit un nœud
   générique (boîte + label + taille par défaut) et **déduit les arêtes
   génériquement des arguments `document_ref`** — **aucun extracteur par kind**. Un
   kind **peut** surcharger taille/rendu/rang de gutter, jamais n'y est obligé. Les
   kinds core dogfoodent le même chemin.

10. **Le modèle Project se généralise en conteneur par kind** (éditeur + plugin).
    Un dossier de kind **inconnu** (module désinstallé) **round-trip en opaque
    préservé** — jamais supprimé : déclinaison de l'invariant « tout vit sur le
    disque du serveur ». `projectFromFiles.ts` `CORE_PREFIXES` doit lister les dirs
    de kind, sinon leurs fichiers sont avalés dans `moduleData.__files`.

11. **Presence.** Les kinds déclarés sont rapportés au `hello`/`modules_changed`
    (`document_kinds`), comme `declared_models`/`editor_screens` : module absent →
    kind **grisé**, dossier opaque (cf. 10).

12. **NPC et Conversation (sémantique).** Un **NPC** = un document = **une entité à
    une position** (comme les plugins NPC classiques). Ses interactions sont des
    triggers **discrets** (v1 : `right_click`, `left_click`). Une **Conversation**
    est un kind **distinct** du **Dialog** : un arbre de répliques et de **choix**
    gardés par conditions, ouvert par `open_conversation <ref>`, potentiellement par
    plusieurs NPC. La **proximité** n'est **pas** un trigger — c'est un état continu
    (zone/tick), **différée**.

13. **SemVer.** `DocumentKindDeclaration` (et ses sous-types Actions/triggers) naît
    **`@Beta`** : on ouvre un point d'extension, on ne le gèle que pour ce qu'on
    montre.

## Décisions tranchées en grill (2026-10-14)

| # | Question | Tranché |
|---|---|---|
| Q1/Q2 | Verbe first-class vs bridge ; vocabulaire d'args | Actions keyed déclarées ; **un** système de types, `document_ref(kind)` seul type neuf ; `run_command` opaque |
| Q3 | `open_menu` spécial ou pas | **Non** — les actions core dogfoodent le registre |
| Q4 | NPC blueprint vs entité | **Entité** — un document = une position |
| Q5 | Dialog vs Conversation | **Kinds distincts** — Conversation = arbre à choix |
| Q6 | Ce que le kind doit au board | **Défauts + arêtes dérivées de `document_ref`** + surcharge optionnelle |
| Q7 | Où vivent les chaînes d'un kind | **Visiteur** (comme `ltextSites`) ; trigger = slot nommé |
| Q8 | Proximité comme trigger NPC | **Non** — différée (mécanisme de zone) |

## Conséquences

- **Chantier de généralisation** documenté dans
  `docs/superpowers/specs/2026-10-14-extensible-document-kinds-design.md` : faire
  passer les kinds core par le registre **sans changement de comportement**,
  verrouillé par `action-dsl-conformance.json` (ou son successeur), `doc-ref-
  conformance.json` et les suites existantes, **avant** d'ouvrir l'enregistrement.
- **CONTEXT.md** (mis à jour le 2026-10-14) : terme **Action** ajouté ; terme
  **Conversation** ajouté ; « un kind de Document » remplace « un des trois kinds »
  (Document/Command/Dialog). *NPC* et *Quest* restent à définir quand leur modèle
  sera grillé.
- **Révision** de `composable-data-models` §6 : les Actions module sont
  first-class, plus seulement le bridge.
- On fige le descripteur `@Beta` et on **n'ouvre pas** de nouvelle API plugin tant
  qu'un pilote (NPC, Conversation ou Quest) ne l'exige pas.

## Révision 2026-10-15 — confrontation au code de `v2`

Faits qui corrigent le texte ci-dessus (le code fait foi) :

- Le wire structuré keyed est **déjà** en production des deux côtés (l'éditeur écrit
  `stepsToStructured`, le plugin lit `KeyedStepParser`) ; `structured-action-wire` passe
  `accepted` le même jour. La condition « si accepté entre-temps » de la spec W1 tombe ;
  le retrait du codec DSL est un nettoyage hors chemin critique.
- Le verrou cross-stack du wire keyed n'existait pas : `testdata/action-wire-conformance.json`
  (`ActionWireConformanceTest` ↔ `lib/actions/actionWireConformance.test.ts`) le crée.
  `action-dsl-conformance.json` ne couvre que le DSL legacy.
- Le field kit réel (`ModelFieldType`, `editor/src/domain/types.ts`) est `string, number,
  integer, boolean, ltext, minimessage, minimessage_multiline, item, actions, conditions, list,
  object, model, map, enum, union`. `material` n'en fait pas partie (c'est `item`).
- Le store éditeur est découpé par kind (`state/account/{menus,dialogs,commands,…}Slice.ts`,
  issue #46) : la carte `file:line` de la spec W5 est rafraîchie en conséquence.
- Deux sites hard-codés manquaient à la spec : `project/ResourceInventory.kt` (les trois
  dossiers) et le relais de présence du hub (`hub/RemoteServer.kt`, liste des champs copiés
  d'une feuille — `document_kinds` doit s'y ajouter).

### Questions ouvertes (à trancher avant le lot « registre d'actions »)

| # | Question | Recommandation |
|---|---|---|
| R1 | Décision 4 : les actions core doivent-elles être **exécutées** via le registre, ou seulement **décrites** par lui ? | **Tranché (Iban, 2026-10-15) : exécutées aussi.** Un seul contrat `ActionHandler { name, args: ModelField[], execute(ctx, args) }`, implémenté par chaque module ; le core dispatche par nom et ne connaît personne. `open_menu` est un handler du module menus comme `start_quest` le sera du module quêtes ; aucun `when`/`if (name === …)` hors d'un handler. L'exhaustivité du compilateur est remplacée par un **test de complétude** (chaque nom du vocabulaire a exactement un handler, dont le schéma coïncide) et par le vecteur `action-wire-conformance.json` ; le typage reste **interne au module** (la sealed class `Action` devient privée à menus/dialogs). Même mécanisme que `DataSourceRegistry`, `CommandRegistry`, `ModelRegistry`, `EditorScreenRegistry`. Deux détails de contrat imposés par le code actuel : (a) `execute` **retourne le contexte suivant** — huit actions core le modifient (`open_previous_menu`, `pagination_*`, `set_arg*`, `run_actions`) et `open_menu`/`open_dialog` poussent l'historique de navigation ; `run_actions` a besoin du runtime (exécuter des steps, résoudre un texte), donc le handler reçoit `(ctx, args, runtime)`. (b) La forme scalaire du wire (`open_menu: shop`) exige un **argument primaire** dans la déclaration : le core normalise `scalaire → {primary: v}`, `null → {}`, `map → map` d'après le schéma, et canonise en sens inverse (seul le primaire renseigné → scalaire, aucun arg → nom nu) ; le handler ne voit jamais la forme du wire. |
| R2 | Décision 10 : conteneur par kind **tout de suite** (≈130 sites éditeur) ou accesseur `documentsOf(project, kind)` + `project.documents[kind]` pour les kinds module, conteneur complet seulement si l'accesseur ne suffit pas ? | **Accesseur d'abord.** Les lecteurs génériques (planche, listing, recherche, i18n, export, `ProjectReader`, `ResourceInventory`) passent par lui ; les lecteurs spécifiques à un kind gardent leur champ. |
| R3 | `document_ref(kind)` : type d'argument à part, ou **kind de `ModelFieldType`** ? | **Kind de `ModelFieldType`.** `ActionDecl.args` devient un `ModelField[]`, `<SchemaForm>` le rend déjà, et une ligne de data model peut pointer un Document avec picker, rename, ref morte et arête par le même visiteur. Seule lecture cohérente de « un seul système de types ». |
| R4 | Qui déclare le kind `quest` : Artisan core ou **MSQuests en add-on** ? | **MSQuests.** L'ADR déclare les kinds par module ; le pilote Quest vit alors dans son dépôt et y tranche `quest/v1`. |
| R5 | W5 et les lots restants de #46 (un store par slice) se chevauchent. | W5 après #46, ou « CRUD générique de Document par kind » intégré au plan #46. |

Précision retenue sans débat : un slot de chaîne est un **site** (`{ name, steps, path }`),
comme `LTextSite`, pas un simple nom — l'extracteur générique d'arêtes a besoin des steps
et du chemin pour conserver les triggers que la planche affiche.

## Hors périmètre / différé

- **Le DSL** : éliminé par `structured-action-wire` ; non réintroduit.
- **Proximité / zones** : mécanisme distinct (état continu), différé.
- **Un kind troisième-partie sans module** : pas de « kind en data ».
- **Modèle interne d'une Quête / d'une Conversation** (objectifs, récompenses,
  nœuds) : à griller avec le pilote, hors de cet ADR.
- **Redéfinition d'une Action core** : un module est namespaced, collision =
  erreur à l'enregistrement.
