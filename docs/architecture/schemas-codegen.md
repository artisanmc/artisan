# Schémas & types — source de vérité, types à la main, enforcement ajv

## Source de vérité

Pour chaque schéma versionné, la vérité est le fichier `docs/schema/<name>/v1/schema.json` (JSON Schema **2020-12**). Tout le reste (types Kotlin, types TS, exemples, fixtures) doit se conformer à ce fichier.

## Types écrits à la main

Les types ne sont **pas générés** — ils sont **écrits à la main** dans les deux langages, en modélisant fidèlement les unions discriminées du schéma :

- **Plugin (Kotlin)** : `sealed class` avec une sous-classe `data class` par variante (ex. `Condition`/`Action` → une sous-classe typée par `type`), désérialisation polymorphe Jackson (`@JsonTypeInfo(use = NAME, property = "type")` + `@JsonSubTypes`).
- **Éditeur (TS)** : unions discriminées (`type Condition = HasPermission | HasMoney | …`), une interface par variante, discriminant `type` littéral.

**Quicktype a été évalué et écarté (NO-GO)** : il aplatit les `oneOf` discriminés par `const` en une seule god-object `data class`/`interface` (tous champs nullables), sans sous-classes ni annotations Jackson, et crashe sur un `const` booléen. Détail et verdict complet dans `docs/schema/CODEGEN.md`. Pas de génération de code.

## Enforcement

La cohérence types ↔ schéma n'est **pas** garantie par codegen mais par validation :

- Validateur **ajv** (draft 2020-12) : `editor/src/schema/validateMenuV1.ts` + `editor/src/schema/validateMenuV1.test.ts`.
- Exemples canoniques : `docs/schema/menu/v1/examples/*.json` (au moins un par variante d'union + menus complets).
- **Phase 2 Action DSL (2026-07-21)** : les chaînes d'actions de clic (`ClickHandler.steps`, `open_actions`/`close_actions`, `command.steps`, actions de boutons de dialogue) sont désormais une **string Action DSL** (cf. ADR `action-dsl`), plus un tableau structuré `{kind,action|cases}`. Le plugin lit la string via le codec `actiondsl` → `DslToEngine` ; `StepParser`/`ActionParser`/`ConditionParser` (Map→objet) restent uniquement pour les chemins non-migrés (`if` d'apparence, `requirements`, `fallback`, API modules). Changement **in-place `menu/v1`** (pas encore en prod).
- **Ergonomie format, tranche ① (2026-07-23)** : `command/v1` — champ canonique **`actions`** (string DSL ; `steps` = alias legacy accepté en lecture), `name` optionnel (défaute sur `id`, l'export ne l'écrit que s'il diffère). `menu/v1` — click handler **collapsé** : `click.left: "<dsl>"` directement (forme `{steps}` legacy acceptée). Writers (éditeur `transform.ts`) émettent les formes canoniques ; readers tolérants sur les 3 couches (éditeur `*ToDomain`, backend `projectImport`, plugin Jackson `@JsonCreator` délégant + `CommandYaml.actions: Any?` désambiguïsé par type). Cf. spec `2026-07-23-menu-format-ergonomics.md`.
- **Ergonomie format, tranches ②–③ (2026-07-23)** : `menu/v1` — **layers aplatis** : forme canonique = liste plate `elements` top-level (ordre document = empilement, dernier gagne par slot ; enveloppe `layers` legacy acceptée en lecture, domaine éditeur garde `Layer`, import plat → une layer default). **Title** : sucre string (`title: "Shop"` = une couche plain) émis quand le titre est une seule couche plain sans couleur ; **une seule forme LText string** (`"{i18n:key}"` ou littéral) pour les `value` de couches — la forme objet `{key}` devient import-only ; entrées string nues dans un tableau de couches = couches plain. Readers tolérants aux deux formes sur les 3 couches (`parseTitleNode`/`titleLayer` éditeur, `importTitle*` backend, `MenuTitleParser.parseLText` plugin).
- **Ergonomie format, tranches ④–⑤ (2026-07-23)** : `positions` accepte int nu / range nu / liste YAML mixte (normalisé en spec string par `positionsSpec` sur les 3 couches ; l'export émet un int nu pour un slot unique). `context_inputs` → **`inputs`** (canonique, optionnel ; legacy accepté partout — `@JsonAlias` plugin). **Sucre ref directe** : `iterates.source` / `places.source` acceptent une ref de source (`ns:id` / `pack:id`) sans déclaration d'input — résolue une fois par `MenuRenderer.open` (exposée sous sa propre clé d'args), ref pendante = liste vide silencieuse (non-hermétique). `inputs` reste pour : signature de paramètres (primitifs des Commands), shaping partagé, typage/autocomplete éditeur.
- CI : `.github/workflows/schema.yml` valide les exemples contre `schema.json` sur chaque PR (pas de step de codegen-drift — la vérité = schéma + ajv).

> **Côté éditeur (P1.1 ✅)** : l'export émet la forme canonique `menu/v1` et un oracle « golden pack → export → ajv » (`editor/src/features/export/canonical.test.ts`) prouve la conformité ; `docs/schema/menu/v1/types.ts` est aligné sur le schéma.
> **Côté plugin (P1.2 ✅)** : le parsing est conforme au canonique. Seul écart introduit par P1.1 corrigé : `ConditionParser` lit désormais `of` (et non `all`/`any`) pour les conditions composites `and`/`or`. Un oracle cross-stack (`plugin/src/test/kotlin/net/artisanmc/plugin/engine/CanonicalConformanceTest.kt`) parse les exemples canoniques de l'éditeur (`docs/schema/menu/v1/examples/canonical-button.json`, `canonical-conditional.json`) à travers `BundleCompiler` sans erreur. Le parsing reste tolérant en lecture (title string-ou-array, `if` map-ou-array).

## Schéma `data/v1` (Project sources, depuis 2026-07-20)

`docs/schema/data/v1/schema.json` décrit les fichiers `data/<source_id>.yaml` d'un Bundle (Project sources, ADR `project-sources-and-data-models`) : `{ schema, id, shape: table|config, key_field?, fields, rows?|value? }`, kinds concrets uniquement (les Data models de l'éditeur sont inlinés à l'export — pas de kind `model` dans le wire). Enforcement : oracle export `editor/src/features/export/dataV1.test.ts` (domain → `serializeDataSource` → forme attendue) + oracle parse plugin `plugin/src/test/kotlin/net/artisanmc/plugin/ProjectDataSourceTest.kt` (fixtures YAML → `ProjectReader`/`BundleDataSource`, localisation ltext). Exemples : `docs/schema/data/v1/examples/*.yaml`.

## Règle de modification

Modifier un `docs/schema/*/v1/schema.json` ⇒ dans le même mouvement :

1. Aligner les types à la main (éditeur **et** plugin).
2. Garder les exemples / fixtures verts (`editor/src/schema/validateMenuV1`).
3. Ne jamais éditer un schéma `v1` déjà shippé en breaking — créer un `v2` (cf. `docs/architecture/versioning.md`).

## Gaps runtime documentés

**Fermés (2026-06-11)** :

- ✅ branches `if` d'un step-tree de clic — `StepParser` + `ActionExecutor.executeSteps`
  (cases/joins/else, joins gauche→droite sans précédence), menus **et** commandes ;
- ✅ actions `set_arg` / `set_arg_cycle_next` / `set_arg_cycle_prev` — mutation des args de
  contexte + re-render du menu courant ; le contexte est replié d'action en action dans un
  même clic ;
- ✅ `context_inputs` + `iterates` (Phase A, plan `2026-06-11-data-driven-runtime-A-iteration.md`) —
  `ContextBinder` (§15.4 : l'appelant gagne, defaults coercés), rendu fenêtré par page
  (pageSize = slots de l'élément), `{alias.field}` via `ArgResolver` (matériel inclus),
  scope d'item par slot au clic (`MenuSession.slotArgs`) ;
- ✅ pagination — `pagination_next/prev` avancent/reculent avec clamp + re-render ;
  `pagination_at_first/last` réelles (état dans `ExecutionContext.pagination`/`pageInfo`,
  aucune modification d'interface `MenuProvider`).

**Restants** (le plugin ne les exécute pas encore — projets séparés) :

- **livraison de données** (Phase B) : `pack.dataSources` non exporté, `ConnectorBinding`
  (`source.ref`/`params`/`filter`/`sort`/`limit`) non résolu, aucun connecteur
  `DataSourceRegistry` implémenté — les listes itérées ne peuvent venir que de l'appelant ;
- évaluation des `expression` (DSL éditeur-only ; une condition `expression` fait dropper
  l'appearance au chargement plugin — retirée du vocab assistant en attendant) ;
- `open_requirements` / `open_actions` / `close_actions` / `background` top-level
  (implémentés nulle part : ni domaine éditeur, ni runtime — rejetés par le gate assistant).

Le schéma les décrit (l'éditeur peut produire/valider certains), mais le runtime plugin les
ignore tant que les projets dédiés ne sont pas livrés.

## Champs additifs `menu/v1` — alignement manuel

Champs ajoutés après le gel P1.0 du schéma, alignés à la main sur les trois couches :

| Champ | Type schema | `docs/schema/menu/v1/types.ts` | `editor/src/domain/types.ts` | Plugin (`AppearanceYaml`) |
|---|---|---|---|---|
| `Appearance.head` | `string` (optionnel) | `head?: string` | `head?: string` | `val head: String?` |

Les trois préfixes reconnus par `HeadRef` (plugin) : `hdb:<id>`, `basehead:<base64>`, `playerhead:<name>` (placeholder-aware, ex. `%player%`). Une valeur brute `eyJ…` sans préfixe est tolérée comme `basehead`. Le champ n'est honoré que quand `material` vaut `PLAYER_HEAD`.

### `inventory_type` (Chest / Hopper / Dropper)

Champ **additif optionnel** au niveau menu (`menu/v1`) : `inventory_type ∈ {chest, hopper, dropper}`, **défaut `chest`**. **Absent ⇒ chest** → full back-compat : tous les menus existants restent des coffres sans migration de données.

Changements de schéma (additifs, non-breaking) :

- `inventory_type` : enum optionnel (`default: "chest"`).
- `size` : enum relaxé à `[5, 9, 18, 27, 36, 45, 54]` (ajout de `5` pour le hopper).
- Cross-validation `allOf` : `chest` ⇒ `size` multiple de 9 ; `hopper` ⇒ `size = 5` ; `dropper` ⇒ `size = 9`.

Resté dans **`menu/v1`** (pas de dossier `v2`) : l'ajout est additif et non-breaking, donc la règle « nouveau schema version = nouveau dossier » (qui cible les changements *breaking*) ne s'applique pas — cf. `docs/architecture/versioning.md`.

Types alignés à la main sur les trois couches :

| Couche | Source |
|---|---|
| Type éditeur | `InventoryType` dans `editor/src/domain/types.ts` |
| Géométrie (single source of truth) | table `INVENTORY_TYPES` dans `editor/src/features/canvas/inventoryTypes.ts` (cols, rows fixes, origine slot-0 en px MC, hauteur de box, clé texture, type Bukkit) |
| Plugin | `MenuYaml.inventoryType` (défaut `chest`) |

Export (`serializeMenuToV1`) : émet `inventory_type` **uniquement si ≠ chest**, et `size = slotCount(type, rows)`. Import (`menuV1ToDomain`) : le lit (défaut `chest`) et calcule les rows par type. Plugin : `MenuRenderer` crée l'inventaire via `InventoryType.HOPPER`/`DROPPER` pour les types non-chest (branche sur le **type**, pas la taille — dropper = 9 slots comme un coffre 1 ligne).

## Statut / phasage

| Phase | Portée | Statut |
|---|---|---|
| **P1.0** | `menu/v1` : schéma canonique + validateur ajv + CI | ✅ fait |
| **P1.1** | Conformité éditeur (export `menu/v1` canonique + `types.ts` aligné sur le schéma + oracle ajv `editor/src/features/export/canonical.test.ts`) | ✅ fait |
| **P1.2** | Conformité plugin (`ConditionParser` lit `of` pour `and`/`or` + oracle cross-stack « exemples éditeur compilent dans le plugin ») | ✅ fait |
| **P2** | `command` / `dialog` / `translations` / `manifest` / `template` (même traitement) | à faire |
