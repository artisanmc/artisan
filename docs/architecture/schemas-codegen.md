# Schémas & types — source de vérité, types à la main, enforcement ajv

## Source de vérité

Pour chaque schéma versionné, la vérité est le fichier `docs/schema/<name>/v1/schema.json` (JSON Schema **2020-12**). Tout le reste (types Kotlin, types TS, exemples, fixtures) doit se conformer à ce fichier.

## Types écrits à la main

Les types ne sont **pas générés** — ils sont **écrits à la main** dans les deux langages, en modélisant fidèlement les unions discriminées du schéma :

- **Plugin (Kotlin)** : `sealed class` avec une sous-classe `data class` par variante (ex. `Condition`/`Action` → une sous-classe typée par `type`), désérialisation polymorphe Jackson (`@JsonTypeInfo(use = NAME, property = "type")` + `@JsonSubTypes`).
- **Éditeur (TS)** : unions discriminées (`type Condition = HasPermission | HasMoney | …`), une interface par variante, discriminant `type` littéral.

**Quicktype a été évalué et écarté (NO-GO)** : il aplatit les `oneOf` discriminés par `const` en une seule god-object `data class`/`interface` (tous champs nullables), sans sous-classes ni annotations Jackson, et crashe sur un `const` booléen. Détail et verdict complet dans `docs/schema/CODEGEN.md`. Pas de génération de code.

## Enforcement

`menu/v1` accepts optional appearance `image: { asset: <project asset id>, fit?: native | contain | stretch, offset_x?: integer, offset_y?: integer }`,
mutually exclusive with `material` and `item`; omitted fit means `contain`.
Offsets default to zero, are bounded to ±4096 pixels and move the centered image
inside its clipped footprint. New editor buttons explicitly use `native`.
This additive field uses the existing v1 appearance format and requires an updated
plugin for rendering. Editor, canonical TS and Kotlin types mirror it manually.
`menu/v1/imageButtons.ts` supplies shared semantic checks to the editor (pack builder included):
fixed, in-bounds rectangular positions without overlap (including other layers).
Comma-separated ranges and YAML position lists support vertical rectangles.
`menuImageButton.test.ts`, `imageButtons.test.ts` and `MenuRendererImageButtonTest`
cover serialization, resource-pack generation, conditional images and clicks.

`menu/v1` porte `$defs/Lore` (2026-10-24, additif) : le `lore` d'une apparence accepte, en plus de la liste de `LText`, une liste de lignes par langue `{ <lang>: string[] }`. Types : `Lore` dans `menu/v1/types.ts`, `LoreDeserializer` côté plugin (même `List<LocalizedText>`, un bloc par langue joint par `\n`). Tests : `FieldLocalTextTest`, `menuV1ToDomain.test.ts`, `projectToFilesInline.test.ts`.

`menu/v1` porte `lore_mode: replace` sur les apparences. Sans ce champ, le lore explicite s'AJOUTE sous le lore de la base. Les valeurs de données `item` composent récursivement `{ extends: <ref ou item>, title?, lore?, count?, ... }` : champs absents hérités, lore ajouté de la même façon. `{base.title}`, `{base.lore}`, `{base.count}` et `{base.material}` désignent la base immédiatement résolue ; écrire `{base.lore}` positionne le lore de base au lieu de le laisser en tête (jamais les deux). Un lore vide n'efface le lore hérité que sous `lore_mode: replace` ; la résolution est bornée à 32 niveaux.

Dans un champ de modèle `item`, `title` et `lore` sont des sites i18n, y compris sous `extends`. `itemTextFields.ts` définit les sites parcourus à l'import et au rekey ; l'export écrit les littéraux de la langue par défaut et les traductions à leurs adresses canoniques.

`menu/v1` porte aussi `Appearance.item` (liaison vers un item complet), exclusif de `material`. Schéma et types : `docs/schema/menu/v1/`. Tests : `menuItemBinding.test.ts` et `MenuRendererItemValueTest`.

### `menu/v2` et `menu/v3` repliés dans `menu/v1` (2026-09-17)

Les deux versions ont vécu six jours, le temps d'ajouter `Appearance.item` puis `lore_mode`. Leurs
migrations (`MenuV1ToV2`, `MenuV2ToV3`) étaient des `data.copy(schema = to)` : **zéro transformation**,
donc trois noms pour un seul format, un ternaire de choix de version à l'export et trois schémas JSON
compilés côté validateurs. Les deux champs ont été repliés dans `menu/v1` et les dossiers `v2`/`v3`
supprimés.

C'est une **dérogation explicite à la règle forward-only** ci-dessous (« on ne modifie jamais un
schéma après ship »). Elle tient parce qu'aucune donnée n'était transformée et que les deux versions
n'avaient pas quitté la semaine de leur release. Le prix payé est une **tolérance en lecture
permanente** : `menu/v2` et `menu/v3` restent acceptés par le lecteur plugin (`ProjectReader.menuSchemaVersions`)
et par les deux validateurs (`LEGACY_VERSIONS`), parce que des projets portant ces étiquettes sont
sur des disques de serveurs. L'écriture, elle, n'émet plus que `menu/v1`. Ne pas rejouer ce pli : la
prochaine version de schéma qui transforme quoi que ce soit est définitivement acquise.

La cohérence types ↔ schéma n'est **pas** garantie par codegen mais par validation :

- Validateur **ajv** (draft 2020-12) : `editor/src/schema/validateMenuV1.ts` + `editor/src/schema/validateMenuV1.test.ts`.
- Exemples canoniques : `docs/schema/menu/v1/examples/*.json` (au moins un par variante d'union + menus complets).
- **Phase 2 Action DSL (2026-07-21)** : les chaînes d'actions de clic (`ClickHandler.steps`, `open_actions`/`close_actions`, `command.steps`, actions de boutons de dialogue) sont désormais une **string Action DSL** (cf. ADR `action-dsl`), plus un tableau structuré `{kind,action|cases}`. Le plugin lit la string via le codec `actiondsl` → `DslToEngine` ; `StepParser`/`ActionParser`/`ConditionParser` (Map→objet) restent uniquement pour les chemins non-migrés (`if` d'apparence, `requirements`, `fallback`, API modules). Changement **in-place `menu/v1`** (pas encore en prod).
- **Ergonomie format, tranche ① (2026-07-23)** : `command/v1` — champ canonique **`actions`** (string DSL ; `steps` = alias legacy accepté en lecture), `name` optionnel (défaute sur `id`, l'export ne l'écrit que s'il diffère). `menu/v1` — click handler **collapsé** : `click.left: "<dsl>"` directement (forme `{steps}` legacy acceptée). Writers (éditeur `schema/*V1FromDomain.ts`, alors `transform.ts`) émettent les formes canoniques ; readers tolérants sur les 3 couches (éditeur `*ToDomain`, backend `projectImport`, plugin Jackson `@JsonCreator` délégant + `CommandYaml.actions: Any?` désambiguïsé par type). Cf. spec `2026-07-23-menu-format-ergonomics.md`.
- **Ergonomie format, tranches ②–③ (2026-07-23)** : `menu/v1` — **layers aplatis** : forme canonique = liste plate `elements` top-level (ordre document = empilement, dernier gagne par slot ; enveloppe `layers` legacy acceptée en lecture, domaine éditeur garde `Layer`, import plat → une layer default). **Title** : sucre string (`title: "Shop"` = une couche plain) émis quand le titre est une seule couche plain sans couleur ; **une seule forme LText string** (`"{i18n:key}"` ou littéral) pour les `value` de couches — la forme objet `{key}` devient import-only ; entrées string nues dans un tableau de couches = couches plain. Readers tolérants aux deux formes (`titleLayer` dans `menuV1ToDomain.ts` côté éditeur, `MenuTitleParser.parseLText` côté plugin).
- **Ergonomie format, tranches ④–⑤ (2026-07-23)** : `positions` accepte int nu / range nu / liste YAML mixte (normalisé en spec string par `positionsSpec` sur les 3 couches ; l'export émet un int nu pour un slot unique). `context_inputs` → **`inputs`** (canonique, optionnel ; legacy accepté partout — `@JsonAlias` plugin). **Sucre ref directe** : `iterates.source` / `places.source` acceptent une ref de source (`ns:id` / `pack:id`) sans déclaration d'input — résolue une fois par `MenuRenderer.open` (exposée sous sa propre clé d'args), ref pendante = liste vide silencieuse (non-hermétique). `inputs` reste pour : signature de paramètres (primitifs des Commands), shaping partagé, typage/autocomplete éditeur.
- **`appearances` retiré au profit de display + `states` (2026-08-17)** : un Element porte son **display à plat** (`material`, `title`, `lore`, `click`… au premier niveau, comme les autres plugins de menu) et ses alternatives gardées sous **`states`** — essayés dans l'ordre AVANT le display, qui est le repli. Un état **remplace**, il n'hérite rien (merge examiné et écarté). `menu/v1` muté sur place, **sans shim de lecture** : `appearances` n'est plus lu nulle part, les menus déployés ont été réécrits (le plugin ne tournait que sur le serveur de test). Schéma : `Element` = `allOf AppearanceFields` + clés structurelles + `unevaluatedProperties: false` ; `states[]` = `$defs/State` (Appearance + `if` requis, sinon l'état masquerait le display pour toujours). Espace de noms partagé verrouillé par `testdata/element-structural-keys.json` (suites éditeur + plugin). Compilation en ordre de RÉSOLUTION (states puis display) avec les ADRESSES i18n inchangées (`default` = display, `stateN` = `states[N-1]`) : aucune clé `lang/` ne bouge. Cf. ADR `element-display-and-states`.
- **Item templates SUPPRIMÉS (2026-07-31)** : `template/v1` et le dossier `docs/schema/template/` n'existent plus, `menu/v1` perd `iterates.template` / `places.template` / `template_ref` (mutation assumée, pas de v2 — cf. ADR `item-templates-and-data-library` révision 2026-07-31). Une apparence appartient au menu qui la rend : l'élément porte toujours ses `appearances`. Un `templates/` legacy sur disque est **inliné à l'import éditeur** (`projectFromFiles`, clés `item_templates.*` ré-adressées en `menus.<m>.elements.<el>.*`, verrouillé par `templateMigration.test.ts`) et jamais réécrit ; `ProjectReader.resolveTemplates` garde la lecture côté plugin en compat le temps que les serveurs déployés soient re-sauvegardés. L'entrée P2a ci-dessous est donc **historique**.
- **P2a templates fichiers (2026-07-23)** : nouveau **`template/v1`** (`docs/schema/template/v1/`) — `templates/<id>.yaml` porte source/alias/key_field/group_by/appearances ; les éléments liés émettent une **ref** `iterates.template` / `places.template` (plus d'inline, `appearances` optionnelles sur Element). Résolution **au load plugin** (`ProjectReader.resolveTemplates` → éléments effectifs, compiler/renderer template-unaware) ; hand-edit d'un template + reload = tous les menus consommateurs suivent. Backend importe `templates/` → `itemTemplates` + refs → `templateId` (fix au passage : `places` était perdu à l'import backend). `manifest.files.templates` additif ; menu/v1 : def `Places` ajoutée, `Iterates.source` sans pattern (refs directes). **P2b models fichiers** : nouveau **`model/v1`** (`docs/schema/model/v1/`) — `models/<id>.yaml` porte les champs **verbatim** (refs cross-model préservées) = store lossless éditeur ; `data/<id>.yaml` reste dénormalisé/self-contained pour le runtime, le plugin ignore `models/`. Backend importe `models/` → `dataModels`. **P3a files-first (2026-07-24)** : l'importeur full-project vit désormais **côté éditeur** (`editor/src/schema/projectFromFiles.ts`, inverse exact de `transform()`, verrouillé par le fixed-point `projectFromFiles.test.ts`) ; le miroir backend `projectImport.ts` est supprimé (reste `lib/projectFiles.ts` pour `readOwnerModuleFromFiles`). Le gap `data/` est comblé : `data/v1` gagne `name` (nom d'affichage) et `model` (back-ref lossless table → `models/<id>.yaml`, **ignorés par le plugin**) ; l'import retype les rows via le model (ltext → LText). Les métadonnées d'items capturés (`name` + `display`) vivent dans `.artisan/editor.yaml` (section `items:`, hash-exclue) ; fichier data sans `model:` → model synthétisé `mdl_<sourceId>` depuis les fields aplatis (canonicalisé au prochain export). **Tranche 1 composable-data-models (2026-07-25, ADR éponyme)** : `model/v1` + `data/v1` gagnent les kinds **`map`** (`of`), **`enum`** (`values`), **`union`** (`tag` + `variants[{name, fields}]`) — dénormalisés **inline** dans data/v1 (le plugin walk valeur+schéma, ltext localisés à toute profondeur, variante choisie par le tag, model-blind inchangé). **Granularité par-row** : `data/<id>/` = `_source.yaml` (méta + fields + `order:`) + un fichier par row nommé par le Row key slugifié ; fichier ajouté à la main hors `order` = appendé (tri byte) ; readers 3 couches (transform/projectFromFiles/ProjectReader). Fix au passage : les rows/items de listes du Table UI sont keyés par identité (Row key), plus par index — le bug « items mélangés entre catégories ». **Tranche 2 (même jour)** : canal de déclaration — `api.models.declare(model/v1)` plugin-side (passthrough opaque) → `hello.declared_models` → table `server_declared_models` (migration 0026, upsert+prune miroir data_sources) → `GET …/servers/:sid/models` → injection au load éditeur (`injectDeclaredModels` : provenance `module`, shape read-only, remplace les copies stale, JAMAIS émis dans `models/`) ; `model/v1` gagne `version` + `migrations` (pas déclaratifs : rename_field/set_default/rename_enum_value/rename_variant — vocabulaire fermé, op inconnue ignorée) ; `data/v1` gagne `model_version` (version sous laquelle les rows ont été écrites) ; moteur `domain/modelMigrations.ts` appliqué au load quand `model_version` retarde, matérialisé au prochain save. **Tranche 3 (même jour)** : les champs `model/v1` portent les hints (`label`/`help`/`section`) + la validation (`required`/`default`/`min`/`max`/`pattern`/`locked`) — enforcement asymétrique (bloquant en form : clamp min/max, select enum, locked read-only ; hand-edit = signalé `aria-invalid` jamais réécrit) ; `master_detail` (model-level) bascule la Table en liste+form ; nouveau kind **`conditions`** (vocabulaire core §6 — valeurs = Condition[] wire via le codec unique, éditées avec le ConditionListEditor des appearances, opaques au runtime).
- **Actions déclarées (2026-10-26)** : `$defs.Action` gagne une dernière branche pour les actions que le serveur déclare au runtime : un objet à une seule clé, nommée soit avec un espace de noms (`^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$`, `guilds:rank_delete` : les add-ons préfixent toutes les leurs), soit `module_command` ou `cancel_event` (les deux qu'Artisan déclare sans préfixe). Ses arguments ne sont pas vérifiés par le schéma. Un nom du cœur mal écrit (`send_mesage`) reste refusé ; un nom préfixé mal écrit (`guilds:rank_delet`) passe, seule l'exécution le signale. Pas de branche pour les conditions : un module n'en déclare pas. Additif. `CoreActionSchemaConformanceTest` ignore cette branche (pas de `required`). Nécessaire depuis que Déployer passe par `DocumentCheck` (ADR `mcp-server`, décision 8) : sans elle, les menus de MSGuilds et d'artisan-attribution étaient refusés.
- CI : `.github/workflows/schema.yml` valide les exemples contre `schema.json` sur chaque PR (pas de step de codegen-drift — la vérité = schéma + ajv).

> **Côté éditeur (P1.1 ✅)** : l'export émet la forme canonique `menu/v1` et un oracle « golden pack → export → ajv » (`editor/src/schema/projectToFilesCanonical.test.ts`) prouve la conformité ; `docs/schema/menu/v1/types.ts` est aligné sur le schéma.
> **Côté plugin (P1.2 ✅)** : le parsing est conforme au canonique. Seul écart introduit par P1.1 corrigé : `ConditionParser` lit désormais `of` (et non `all`/`any`) pour les conditions composites `and`/`or`. Un oracle cross-stack (`plugin/core/src/test/kotlin/net/artisanmc/plugin/engine/CanonicalConformanceTest.kt`) parse les exemples canoniques de l'éditeur (`docs/schema/menu/v1/examples/canonical-button.json`, `canonical-conditional.json`) à travers `MenuCompiler` sans erreur. Le parsing reste tolérant en lecture (title string-ou-array, `if` map-ou-array).

## Schéma `data/v1` (Project sources, depuis 2026-07-20)

`docs/schema/data/v1/schema.json` décrit les fichiers `data/<source_id>.yaml` d'un Project (Project sources, ADR `project-sources-and-data-models`) : `{ schema, id, shape: table|config, key_field?, fields, rows?|value? }`, kinds concrets uniquement (les Data models de l'éditeur sont inlinés à l'export — pas de kind `model` dans le wire). Enforcement : oracle export `editor/src/schema/dataV1FromDomain.test.ts` (domain → `projectToFiles` → forme attendue) + oracle parse plugin `plugin/core/src/test/kotlin/net/artisanmc/plugin/ProjectDataSourceTest.kt` (fixtures YAML → `ProjectReader`/`RuntimeDataSource`, localisation ltext). Exemples : `docs/schema/data/v1/examples/*.yaml`.

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
- ✅ navigation arrière — `open_previous_menu` (pile LIFO par joueur, menus + dialogs) et
  placeholders `has_previous_menu` / `previous_menu.*` ; vocabulaire `menu/v1` étendu, pas de
  breaking (cf. `action-steps.md` §open_previous_menu).

**Restants** (le plugin ne les exécute pas encore — projets séparés) :

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

### Détails avancés d'item (2026-07-29)

Sept champs **additifs optionnels** sur `Appearance`, tous appliqués par `net.artisanmc.plugin.render.ItemDetails` :

| Champ wire | Domaine éditeur | Plugin (`AppearanceYaml`) |
|---|---|---|
| `enchants` (map `{id: level}`, liste `[{id, level}]` en lecture) | `enchants?: ItemEnchant[]` | `val enchants: Any?` |
| `enchanted` (bool) | `enchanted?: boolean` | `val enchanted: Boolean` |
| `custom_model_data` (string) | `customModelData?: string` | `val customModelData: String?` |
| `unbreakable` (bool) | `unbreakable?: boolean` | `val unbreakable: Boolean` |
| `hide` (enum[]) | `hide?: ItemHideFlag[]` | `val hide: List<String>` |
| `color` (`#rrggbb`) | `color?: string` | `val color: String?` |
| `nbt` (SNBT) | `nbt?: string` | `val nbt: String?` |

`enchanted` et `custom_model_data` étaient déclarés dans le schéma depuis P1.0 mais **morts** (ni portés par `AppearanceYaml`, ni appliqués par `MenuRenderer.buildItem`) — cette tranche les implémente enfin plutôt que d'introduire des noms concurrents.

Conventions partagées entre l'éditeur (`editor/src/domain/itemAdvanced.ts`) et le plugin (`ItemDetails.kt`), qui se **mirroitent** — changer l'un impose de changer l'autre :

- **Ids d'enchantement tolérants en lecture** : `sharpness`, `minecraft:sharpness`, `SHARPNESS`, legacy Bukkit `DAMAGE_ALL`. La forme canonique écrite est toujours l'id court en map. Un id inconnu du serveur est **ignoré avec un WARN** (jamais une erreur de menu).
- **Niveaux au-delà du max vanilla autorisés** (`ignoreLevelRestriction`) — les serveurs en usent ; l'UI se contente d'avertir.
- **`enchanted` est omis à l'écriture quand `enchants` est non-vide** : de vrais enchantements brillent déjà, le flag ne porte son sens que seul.
- **`hide`** : orthographe courte (`attributes`) canonique, spelling Bukkit (`HIDE_ATTRIBUTES`) et l'ancien `HIDE_POTION_EFFECTS` → `additional` acceptés en lecture.
- **`nbt`** : appliqué **en dernier**, après tout le reste, via `Bukkit.getUnsafe().modifyItemStack` (API dépréciée — seule voie sur 1.21.4). Best-effort : un SNBT refusé est loggé en WARN et l'item est rendu sans, jamais blanchi.
- **`color`** : n'a d'effet que sur `LeatherArmorMeta` / `PotionMeta` ; sur tout autre material c'est silencieusement sans objet (pas une erreur). L'éditeur n'affiche le champ que pour les materials teintables (`isColorable`).

Resté dans **`menu/v1`** : purement additif et optionnel, donc non-breaking (cf. `versioning.md`).

**Extraction d'items capturés** — `editor/src/domain/capturedStack.ts` lit ces mêmes détails depuis le `stackYaml` d'un item capturé (l'ItemStack Bukkit sérialisé verbatim). Il gère les **deux formes** de sérialisation qui circulent : legacy Bukkit (`type`/`amount`/`meta{enchants, ItemFlags, custom-model-data, color}`) et Paper moderne (`id`/`count`/`components{minecraft:enchantments, …}`, avec ou sans l'enveloppe `levels` supprimée en 1.21.5). Une troisième forme s'ajoute aux deux précédentes : les **composants encodés en chaîne** (`minecraft:enchantments: '{"minecraft:sharpness":5}'`) — c'est celle que Paper produit réellement. `decodeComponent` les décode (JSON strict, puis passe de tolérance SNBT pour les clés nues et les suffixes de type `5s`/`1b`) ; `custom_name` et `item_name` sont des composants **texte** et restent hors décodage. Aucun aller-retour plugin n'est nécessaire : tout est déjà dans le YAML. Le parse est mémoïsé (`capturedStackDetails`) car `resolveDisplayRef` l'appelle par slot rendu.

`readCapturedItems` (import, `projectFromFiles.ts`) dérive son descripteur d'affichage via ce même parseur depuis 2026-07-29 — auparavant c'étaient des regex sur le YAML brut (`"nexo:id":"…"`, `text: "…"`) qui ne matchaient pas la forme encodée. **La précédence est inchangée** : `.artisan/editor.yaml` `items:` reste autoritaire quand il est présent, car il enregistre ce que le panneau de capture affichait — dont un material enrichi par le reverse-lookup custom-item du plugin, que le stack seul n'exprime pas toujours. La dérivation ne sert qu'aux fichiers ajoutés à la main ou écrits par un module.

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

Export (`menuV1FromDomain`) : émet `inventory_type` **uniquement si ≠ chest**, et `size = slotCount(type, rows)`. Import (`menuV1ToDomain`) : le lit (défaut `chest`) et calcule les rows par type. Plugin : `MenuRenderer` crée l'inventaire via `InventoryType.HOPPER`/`DROPPER` pour les types non-chest (branche sur le **type**, pas la taille — dropper = 9 slots comme un coffre 1 ligne).

### `player_inventory` (bas de la fenêtre, 2026-09-25)

Champ **additif optionnel** au niveau menu : `player_inventory ∈ {visible, hidden}`, **défaut
`visible`** — les menus existants ne changent pas. `hidden` : les positions `size..size+35` désignent
les slots joueur (rawSlot protocole, 27 principal puis 9 barre rapide) et le bas n'affiche que les
boutons du menu. Le schéma ne borne pas les positions (JSON Schema ne compare pas à `size`) : la borne
vit dans `validateMenuLayout` (`types.ts`) et dans l'éditeur (`positionCount`).

| Couche | Source |
|---|---|
| Type éditeur | `PlayerInventoryMode`, `Menu.playerInventory` (stocké seulement si `hidden`) |
| Géométrie | `positionCount`, `slotMcXY(i, type, rows)`, `positionToCell`/`cellToPosition` dans `inventoryTypes.ts` (`playerInvY` par type) |
| Plugin | `MenuYaml.playerInventory` → `PlayerInventoryMode` → `MenuSlots.slotLimit` |

Export : émis **uniquement si `hidden`**. Resté dans `menu/v1` (additif). Runtime : cf.
`invariants.md` « Le contenu des menus n'existe que côté client ».

### `vanilla_texture` (fond de conteneur transparent, 2026-09-25)

Booléen **additif optionnel**, **défaut `true`**. `false` : fenêtre
transparente en jeu (coffre, entonnoir ou dropper), le menu apporte sa texture par des glyphs de titre. Domaine éditeur
`Menu.vanillaTexture?: false` (stocké seulement à `false`), export émis seulement à `false`, plugin
`MenuYaml.vanillaTexture`. Effets hors du menu (pack + réinjection sur les autres coffres) :
`invariants.md` « Conteneurs transparents ».

## Statut / phasage

| Phase | Portée | Statut |
|---|---|---|
| **P1.0** | `menu/v1` : schéma canonique + validateur ajv + CI | ✅ fait |
| **P1.1** | Conformité éditeur (export `menu/v1` canonique + `types.ts` aligné sur le schéma + oracle ajv `editor/src/schema/projectToFilesCanonical.test.ts`) | ✅ fait |
| **P1.2** | Conformité plugin (`ConditionParser` lit `of` pour `and`/`or` + oracle cross-stack « exemples éditeur compilent dans le plugin ») | ✅ fait |
| **P2** | `command` / `dialog` / `translations` / `manifest` / `template` (même traitement) | à faire |
