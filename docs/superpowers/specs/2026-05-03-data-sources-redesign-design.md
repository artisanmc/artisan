# Data Sources Redesign — Design Spec

**Date** : 2026-05-03
**Statut** : Design validé, à découper en plans d'implémentation (C1, C2, C3)
**Auteur** : iban (brainstorming session avec Claude)

## Résumé

Refonte complète du modèle de contexte des menus pour résoudre trois pain points identifiés à l'usage :

1. **Complexité non uniforme** : `ContextInput.default` (runtime fallback) et `Menu.sampleContext` (preview éditeur) sont deux concepts qui se chevauchent.
2. **Preview manuelle** : l'admin doit écrire `sampleContext` à la main pour voir des données dans l'éditeur.
3. **Objects non typés** : pas de schema sur `type: "object"` ou `type: "list"`, donc pas d'autocomplete sur `{quest.name}` et pas de validation au design time.

Solution : unifier le concept en **"sources de données typées"**, drop `sampleContext`, ajouter un schema récursif sur les valeurs typées, séparer les data admin-made (page dédiée) des connecteurs plugin (import depuis Java).

## Motivation

### Pain points concrets

- `ContextInput.default: string` ne peut pas représenter naturellement une liste de catégories (`["weapon", "armor"]`). L'admin doit utiliser des connecteurs ou se rabattre sur du JSON encodé en string — ni l'un ni l'autre n'est satisfaisant pour les cas simples.
- `Menu.sampleContext` est un blob YAML/JSON séparé que l'admin écrit pour la preview. Le contenu duplique souvent les valeurs `default` des inputs primitifs.
- L'autocomplete sur `{quest.name}` est impossible aujourd'hui parce que rien ne déclare ce que `quest` contient. `quest` est juste une string opaque pour l'éditeur.

### Use case déclencheur

Pendant le brainstorming Plan B, deux frictions sont remontées :
- **Array literals** dans `set_arg_cycle.list` : pour cycler `["weapon", "armor"]`, l'admin doit déclarer un `ContextInput type=list` mais n'a aucun moyen propre d'y mettre des valeurs hardcodées.
- **Quotes obligatoires** dans `set_arg.value` : symptôme de l'absence de typage — le parser ne peut pas distinguer un nom d'identifier d'une valeur littérale, donc tout est expression.

Avec le redesign, l'admin déclare une `pack.categories: list of string = ["weapon", "armor", "food"]`, le menu la référence, et tout coule de source : preview, autocomplete, runtime.

## Décisions de design (résumé)

- **Drop `Menu.sampleContext`** entièrement. La preview éditeur s'autobuild des `default`s primitifs + valeurs des data sources + samples des connecteurs.
- **`ContextInput` devient une union discriminée** par `kind` : `"primitive"` (player/string/int/number/boolean avec default) vs `"sourceRef"` (référence à une source par `ref`).
- **Nouveau `FieldType` récursif** pour décrire les schemas (string/number/boolean/list/object récursifs).
- **Nouveau `Pack.dataSources[]`** : sources admin-made avec id, name, type (FieldType), value. Vivent au niveau du pack, référencées en live par les menus.
- **Nouveau `Pack.importedConnectors[]`** : specs de connecteurs sourcés depuis Java plugin (ChestShop, Essentials, etc.).
- **Pas de catalogue centralisé** : les connecteurs sont entièrement Java-sourced. Le plugin Artisan génère un YAML par connecteur dans `plugins/Artisan/connectors/`. Le plugin auteur tier (V2+) fait pareil via `registerDataSource`.
- **Plan paid (WS)** : auto-push des connecteurs YAMLs à la connexion. **Plan free** : bouton "Importer connecteurs" pour drop-and-drop manuel.
- **Pas de migration** : les packs existants verront `sampleContext` dropped au load et leurs `ContextInput type=list/object` devenir invalides. L'admin recrée. Acceptable parce qu'on est en pré-launch et qu'iban est le seul admin avec packs en dev.
- **Découpage en 3 specs** d'implémentation (C1, C2, C3) — détails section 8.

## 1. Modèle de domaine

### 1.1 Vue d'ensemble — trois origines unifiées

Tout `ContextInput` d'un menu pointe vers une "source de données typée". Trois origines :

| Source | Auteur | Schema connu via | Valeurs preview |
|---|---|---|---|
| **Primitive** (`player`/`string`/`integer`/`number`/`boolean`) | Caller (commande, parent menu) | Type built-in | Le `default` du primitive |
| **Pack data source** (admin-made) | Admin dans la page Data | `FieldType` explicite stocké avec | Les valeurs entrées par l'admin |
| **Connecteur** (plugin tier) | Java plugin (ou Artisan plugin pour V1 homemade) | Spec YAML générée par le plugin | `sample` dans le YAML |

Le menu déclare ses inputs ; l'éditeur résout chaque ref vers sa source ; preview + autocomplete tombent automatiquement.

### 1.2 Types TypeScript

```typescript
// web/src/domain/types.ts (changes)

// Récursif, décrit n'importe quelle shape de donnée typée
export type FieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "list"; of: FieldType }
  | { kind: "object"; fields: { name: string; type: FieldType }[] };

// Source de données admin-made — vit au niveau pack
export type DataSourceId = string & { __brand: "DataSourceId" };

export interface DataSource {
  id: DataSourceId;     // unique within pack, slug-style ("categories", "default_quests")
  name: string;         // display name shown in pickers
  type: FieldType;      // recursive schema
  value: unknown;       // concrete data, validated against `type` at edit time
}

// Spec d'un connecteur (importé manuellement ou poussé via WS)
export interface ConnectorSpec {
  ref: string;          // "chestshop:items", "essentials:warps", "questx:quests"
  type: FieldType;      // typically `{ kind: "list", of: { kind: "object", ... } }`
  sample: unknown;      // 3-5 sample items, validated against `type`
}

// Pack additions
export interface Pack {
  // ... champs existants
  dataSources: DataSource[];           // NEW
  importedConnectors: ConnectorSpec[];  // NEW
}

// ContextInput devient une union discriminée
export type ContextInput =
  | {
      kind: "primitive";
      name: string;
      type: "player" | "string" | "integer" | "number" | "boolean";
      default?: string;
    }
  | {
      kind: "sourceRef";
      name: string;
      ref: SourceRef;
    };

// Référence vers une source — discriminée par préfixe
// "pack:<dataSourceId>" pour admin-made
// "<plugin>:<connectorSource>" pour connecteur (e.g., "chestshop:items")
export type SourceRef = string & { __brand: "SourceRef" };
```

### 1.3 Suppression de `Menu.sampleContext`

Le champ `Menu.sampleContext` disparaît du schéma. La preview éditeur build à la volée :

```typescript
// Pseudo-code de l'algo de résolution preview
function buildPreviewScope(menu: Menu, pack: Pack): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      scope[input.name] = coerceDefault(input.default, input.type);
    } else {
      const source = resolveSourceRef(input.ref, pack);
      if (source !== null) scope[input.name] = source.value;  // pour DataSource
      // ou source.sample pour ConnectorSpec
    }
  }
  return scope;
}
```

Plus de blob JSON/YAML manuel. Plus de `SampleContextEditor` UI.

### 1.4 ContextInput live references — semantics

Quand un `ContextInput { kind: "sourceRef" }` pointe vers `pack:categories` :
- Au render preview, l'éditeur lit `pack.dataSources` et trouve l'entry avec `id === "categories"`.
- Si l'admin renomme `categories` → `shop_categories`, **tous les menus qui référencent `pack:categories` voient leur ref mise à jour atomiquement** (immer transaction). Les ContextInputs sont mis à jour avec le nouveau ref.
- Si l'admin **supprime** une DataSource, l'éditeur warn ("3 menus utilisent cette source — supprimer rendra leurs inputs invalides"). Si confirmé, les ContextInputs concernés deviennent invalides (lookup retourne null au runtime, panneau "Issues" liste l'erreur à l'édition).

## 2. Page Data Sources (UX)

### 2.1 Placement

Onglet/page dédié au niveau du pack, accessible depuis le top-bar (à côté de "Translations", "Patterns"). Layout pleine page comme TranslationPanel existante.

### 2.2 Layout 2-column

```
┌──────────────────────────┬─────────────────────────────────────┐
│ Pack data                │ categories                          │
│ ├ 🗂 categories       ✓  │ ┌─ Schema (inline) ──────────────┐  │
│ ├ 🗂 quests              │ │ Liste de [string ▾]             │ │
│ └ 📦 server_motd         │ └─────────────────────────────────┘ │
│ + Liste  + Objet         │                                     │
├──────────────────────────┤ ┌─ Values ───────────────────────┐  │
│ Connectors               │ │  • weapon                       │ │
│ ├ 🔌 chestshop:items     │ │  • armor                        │ │
│ ├ 🔌 chestshop:cats      │ │  • food                         │ │
│ └ 🔌 essentials:warps    │ │  + Add                          │ │
│ + Importer               │ └────────────────────────────────┘  │
└──────────────────────────┴─────────────────────────────────────┘
```

### 2.3 Sidebar gauche

Deux sections empilées :

**Pack data** (top) — sources admin-made.
- Chaque entrée : icône (🗂 list / 📦 object), nom, optionnellement un badge type courte ("string list", "object")
- Boutons "+ Liste" et "+ Objet" en bas → crée une DataSource avec un nom auto (`new_list`, `new_object`) et schema minimal
- Click une entrée → l'éditeur la sélectionne et affiche son schema + values dans le panneau droit
- Right-click ou hover → menu "Renommer", "Supprimer", "Dupliquer"

**Connectors** (bottom) — `Pack.importedConnectors`.
- Chaque entrée : icône 🔌, le `ref` (e.g., `chestshop:items`)
- Bouton "+ Importer" → workflow d'import (cf. section 3.3)
- Click une entrée → panneau droit en mode read-only, montre le schema + sample. L'admin ne peut pas éditer (ça vient du plugin), mais peut copier le `ref`.

### 2.4 Édition du schema (inline, en haut du panneau droit)

Le schema d'une DataSource est éditable en permanence en haut du panneau, pas caché derrière une modale. Builder récursif :

- Type racine = dropdown : `string` / `number` / `integer` / `boolean` / `list of...` / `object with...`
- "list of" → panneau enfant avec un dropdown récursif pour le type d'item
- "object with" → liste de paires `(name, type)` éditables, drag-handle pour réordonner. Chaque type est récursif (peut être primitive, list, ou object).

Exemple visuel pour un `list of object` à 2 niveaux :

```
Schema:
  Liste de
    Objet avec
      ├ name      [string ▾]                       [×]
      ├ gold      [number ▾]                       [×]
      ├ tags      [list of [string ▾]]             [×]
      └ + Add field
```

### 2.5 Modifications destructives du schema

Changer un type de `string → number`, retirer un field, etc. peut casser des `value`s existantes ou des références dans des templates. L'éditeur warn par modale :

> Schema change will reset 3 values incompatible with the new type. Continue?

Si confirmé, l'éditeur coerce les valeurs compatibles, drop les autres. Les templates qui pointaient vers le field supprimé deviennent invalides au panel Issues (pas de cascade automatique sur les templates ; trop magique).

### 2.6 Édition des valeurs (inline, sous le schema)

Driven by le schema résolu :

- **Liste de primitive** : input par item, chaque item dans une row, drag-handle pour réordonner, "+ Add" en bas.
- **Liste de objet** : tableau (rows = items, cols = fields). Cliquer sur une cell → input typé selon le field. "+ Add row" en bas, "× delete row" inline.
- **Objet** : form layout (un input par field).
- **Nesting** : un field "list" devient un sous-tableau inline (collapsable). Un field "object" devient un sous-form. Récursif.

L'éditeur valide les valeurs contre le schema en live ; cells invalides ont un border rouge + message inline.

### 2.7 Référencement depuis un menu

Dans le `ContextInputsEditor` du `MenuProperties` panel, l'admin clique "+ Add input" et choisit :

```
+ Add input
  ┌──────────────────────────┐
  │ Type:                     │
  │  ○ Primitive (caller)     │
  │     [player ▾]            │
  │     default: ___________  │
  │  ○ Pack data source       │
  │     [▾ Pick: categories]  │
  │  ○ Connector              │
  │     [▾ Pick: chestshop…]  │
  └──────────────────────────┘
  [ Add ]  [ Cancel ]
```

- "Primitive" → comme aujourd'hui (name + type + optional default)
- "Pack data source" → dropdown listant `pack.dataSources[*]` par id+name
- "Connector" → dropdown listant `pack.importedConnectors[*]` par ref

Sélectionner une source pré-remplit le `name` du ContextInput avec un défault sensé (genre l'id de la source). L'admin peut renommer (le `name` est l'identifier interne au menu pour le placeholder `{name}`).

Le dropdown affiche le schema résolu en hover (genre `[list of {name: string, gold: number}]`) pour confirmation.

## 3. Connecteurs

### 3.1 Format YAML

Un fichier par connecteur dans `plugins/Artisan/connectors/<plugin>-<source>.yaml` :

```yaml
ref: chestshop:items
schema:
  kind: list
  of:
    kind: object
    fields:
      - { name: id, type: { kind: string } }
      - { name: name, type: { kind: string } }
      - { name: material, type: { kind: string } }
      - { name: price, type: { kind: number } }
      - { name: tags, type: { kind: list, of: { kind: string } } }
sample:
  - { id: diamond, name: "Diamant", material: DIAMOND, price: 100, tags: [gem, premium] }
  - { id: gold_ingot, name: "Lingot d'or", material: GOLD_INGOT, price: 50, tags: [metal] }
  - { id: bread, name: "Pain", material: BREAD, price: 5, tags: [food] }
```

Le `schema` mirror exactement la `FieldType` récursive du domain. Le `sample` est validé contre le schema au parse.

### 3.2 Génération côté Java plugin

Au boot, le plugin Artisan :
1. Récupère sa liste de connecteurs enregistrés (registre interne en V1, plus `registerDataSource` API en V2+ pour plugins tiers)
2. Pour chacun, demande à son auteur le schema + sample (Java methods sur `Connector`)
3. Sérialise en YAML dans `plugins/Artisan/connectors/`

L'API Java précise (interfaces, méthodes) est **hors scope du présent spec**. Couvert dans la spec Java plugin séparée.

### 3.3 Import workflow côté éditeur

#### Plan paid (WebSocket connecté)

À la connexion serveur, le plugin push un message `connectors-update` contenant la liste des YAMLs. L'éditeur les parse et merge dans `pack.importedConnectors[]`. Si un connecteur existait déjà (par `ref`), update remplace.

#### Plan free

Bouton "📥 Importer connecteurs" dans la sidebar gauche de la page Data sources. Click → file picker système, multi-select de `.yaml`. Chaque fichier :
- Parsed → ConnectorSpec validé
- Si OK → ajouté à `pack.importedConnectors[]` (replace by ref si existant)
- Si erreur → toast d'erreur, fichier ignoré, autres processés normalement

Bouton "Re-importer" et "Supprimer ce connecteur" sur chaque entrée importée (hover overlay).

### 3.4 Stockage avec le pack

Les `ConnectorSpec` importés vivent dans `pack.importedConnectors[]` — donc shippés avec le pack lors d'un export. Un pack importé chez quelqu'un d'autre (Discord, marketplace V2) arrive avec ses connecteurs déjà préemballés. Pas besoin que le destinataire ait le plugin source pour éditer (juste pour exécuter au runtime).

### 3.5 Résolution d'un sourceRef

Au render preview ou autocomplete, étant donné un `ref: SourceRef` :

1. Si `ref` commence par `pack:` → lookup dans `pack.dataSources` par id
2. Sinon → lookup dans `pack.importedConnectors` par `ref` exact
3. Sinon → null (input invalide, surfacé au panel Issues)

## 4. Migration

**Aucune migration**. Les packs existants au moment du déploiement de C1 verront :
- `Menu.sampleContext` dropped silencieusement par l'immer producer (le champ disparaît du schéma TS, donc pas préservé)
- Les `ContextInput` existants avec `type: "list"` ou `type: "object"` deviennent invalides selon le nouveau modèle (le union discriminé ne permet pas ces types pour `kind: "primitive"`). TypeScript catch ça à la compilation des reducers.
- Les `ContextInput` existants avec `source: ConnectorBinding` deviennent aussi invalides (le champ source disparaît du primitive, et il faut migrer vers `kind: "sourceRef"`).

Acceptable parce que :
- Pré-launch : iban est le seul admin avec des packs réels
- Les packs de tests/exemples seront mis à jour à la main si besoin
- Une approche "soft-fail" (les inputs invalides apparaissent comme tels au panneau Issues, runtime no-op) protège des crashs

## 5. Out of scope V1

Volontairement reportés :

- **WS push de connecteurs depuis le plugin** (V2 — couvre plan paid). C1/C2/C3 ne traitent que l'import manuel.
- **Live data fetch** côté connecteurs (V2 — quand serveur connecté en plan paid, push de vraies données qui override le sample du YAML).
- **Multi-iter preview** (déjà différé en B4)
- **Autocomplete poussé sur les `{alias.field}`** — l'infrastructure type est mise en place par C1, mais le wiring autocomplete UI peut attendre un plan séparé après C2.
- **Plain-language errors étendus** (déjà adressés en B5 pour parse errors ; type errors sur les sourceRefs sont à venir)
- **Field rename cascade** : si l'admin renomme un field d'une DataSource, les templates qui pointent vers `{quest.<oldname>}` ne sont pas auto-renommés. Trop magique. L'éditeur les signale au panel Issues.

## 6. Découpage en 3 specs

Vu l'ampleur, le travail s'éclate en 3 plans d'implémentation séquentiels avec parallélisme entre C2 et C3 :

### Spec C1 — Domain refactor

**Scope** :
- Refactor des types : `FieldType`, `DataSource`, `ConnectorSpec`, `ContextInput` union discriminée, `Pack.dataSources`, `Pack.importedConnectors`
- Drop `Menu.sampleContext`
- Update les reducers immer : addPackDataSource, removePackDataSource, etc.
- Update `walkActions`, `placeholders.ts`, etc. pour pointer vers le nouveau modèle
- Casse les packs existants (assumed OK)

**Dépendances** : aucune

**Estimation** : medium — beaucoup de refactor mais pas de UI new

### Spec C2 — Data sources page

**Scope** :
- Nouvelle page `/pack/$packId/data` (route TanStack)
- Composant `DataSourcesPage` avec layout 2-column
- Sidebar gauche : sources admin-made + section connecteurs imported (read-only display)
- Panneau droit : `<DataSourceEditor>` avec schema editor inline + value editor récursif
- Bouton trigger dans le top-bar du pack
- i18n keys

**Dépendances** : Spec C1

### Spec C3 — Connector import workflow

**Scope** :
- Bouton "Importer connecteurs" dans la sidebar de la page Data sources
- File picker → parser YAML → ConnectorSpec
- Validation du schema + sample contre `FieldType`
- Stockage dans `pack.importedConnectors`
- Toasts pour succès/erreur par fichier
- Boutons re-import / delete par connecteur importé

**Dépendances** : Spec C1 (au moins ContextInput.sourceRef et Pack.importedConnectors). Peut être implémenté en parallèle avec C2.

## 7. Glossaire

| Terme | Sens |
|---|---|
| **DataSource** | Source de données admin-made, vit dans `pack.dataSources[]`. A un id, name, FieldType (schema), value. Référencée par `ref: "pack:<id>"` depuis les ContextInputs. |
| **ConnectorSpec** | Spec d'un connecteur de plugin tier. Vit dans `pack.importedConnectors[]`. A un ref (e.g., `chestshop:items`), schema, sample. Vient d'un YAML importé manuellement (plan free) ou pushé via WS (plan paid). |
| **FieldType** | Type récursif décrivant la shape d'une donnée typée. Discriminé par `kind` (string/number/integer/boolean/list/object). |
| **ContextInput** | Slot typé qu'un menu déclare et que ses appearances/actions/conditions consomment via `{name}`. Union discriminée par `kind` : `"primitive"` (caller-passed simple) ou `"sourceRef"` (référence vers une source). |
| **SourceRef** | Référence textuelle vers une source : `"pack:<dataSourceId>"` pour admin-made, `"<plugin>:<source>"` pour connecteur. |
| **Pack data** | Sources admin-made (DataSource), distinct des Connectors (sourcés depuis Java plugins). |
