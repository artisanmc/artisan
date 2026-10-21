# Canvas layout persistence — design

**Date:** 2026-05-19
**Status:** Approved (pending review)

## Problème

`Pack.canvasLayout` — les positions `{ x, y }` des cartes Menu / Command / Dialog dans le canvas du pack — vit aujourd'hui uniquement dans :

- `editor/src/state/accountStore.ts` (zustand + localStorage)
- `packBundles.editorJson` côté backend (écrit par `PUT /api/editor-session/:token/packs/:packId` et `POST .../deploy`)

Elle n'est **pas** sérialisée dans les YAML du pack (`editor/src/features/export/transform.ts:542-555`). Conséquence : si un admin copie `plugins/Artisan/packs/<id>/` d'un serveur A vers un serveur B (file copy hors éditeur), le plugin B republie via `hello` → le backend B reconstruit `editorJson` depuis les fichiers via `importPackFromFiles` → `canvasLayout: {}` à `backend/src/lib/packImport.ts:239`. Les cartes retombent sur le grid auto par défaut.

But : positions portées par les fichiers eux-mêmes, donc transférables.

## Décisions clés

- **Source de vérité = fichiers (`manifest.yaml`).** `editorJson.canvasLayout` est un cache dérivé.
- **Emplacement = `manifest.yaml`**, dans un champ optionnel `editor_layout`.
- **Plugin** : aucun changement. Le champ est ignoré (déjà `@JsonIgnoreProperties(ignoreUnknown = true)` sur `ManifestYaml`). Le fichier traverse plugin → bundle → backend intact.
- **Pas de migration.** Packs existants → `canvasLayout: {}` à l'import → `autoLayout` peuple le grid déterministe. La première mutation persiste les positions dans le manifest.

## Schéma `manifest.yaml`

```yaml
schema: manifest/v1
pack_id: my_pack
default_lang: en
languages: [en, fr]
files:
  menus: [main, shop]
  commands: [open_shop]
  dialogs: []
editor_layout:                # ← optionnel, omis si vide
  main:       { x: 40,  y: 40 }
  shop:       { x: 260, y: 40 }
  open_shop:  { x: 480, y: 40 }
```

- Clés : `MenuId | CommandId | DialogId` (même espace d'ids que `canvasLayout` aujourd'hui).
- Valeurs : `{ x: number, y: number }`.
- Schema version inchangé (`manifest/v1`). Le champ étant optionnel + ignoré par les parseurs tolérants, pas de breaking change.

## Changements par module

### Éditeur — `editor/src/features/export/transform.ts`

Avant l'écriture de `manifest.yaml`, construire `editor_layout` à partir de `pack.canvasLayout` filtré sur les ids encore vivants :

```ts
const layoutIds = new Set<string>([
  ...pack.menus.map(m => m.id),
  ...pack.commands.map(c => c.id),
  ...pack.dialogs.map(d => d.id),
]);
const editorLayout = Object.fromEntries(
  Object.entries(pack.canvasLayout).filter(([id]) => layoutIds.has(id))
);

const manifest: Record<string, unknown> = {
  schema: "manifest/v1",
  pack_id: pack.id,
  default_lang: pack.defaultLang,
  languages: langs,
  files: { menus: ..., commands: ..., dialogs: ... },
};
if (Object.keys(editorLayout).length > 0) {
  manifest.editor_layout = editorLayout;
}
files[`${base}/manifest.yaml`] = stringify(manifest, yamlOpts);
```

Pourquoi filtrer : éviter que `canvasLayout` contienne des entrées orphelines (id d'un menu supprimé) qui pollueraient le YAML et survivraient à un round-trip.

### Backend — `backend/src/lib/packImport.ts`

`importPackFromFiles` lit aujourd'hui le manifest avec `tryParse<ManifestYaml>` puis renvoie `canvasLayout: {}` en dur (ligne 239). Extension :

```ts
interface ManifestYaml {
  pack_id?: string;
  default_lang?: string;
  files?: { menus?: string[]; commands?: string[]; dialogs?: string[] };
  editor_layout?: Record<string, { x?: number; y?: number }>;
}

function parseEditorLayout(raw: ManifestYaml["editor_layout"]): Record<string, { x: number; y: number }> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!v || typeof v.x !== "number" || typeof v.y !== "number") continue;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
    out[id] = { x: v.x, y: v.y };
  }
  return out;
}

// ... in returned object:
canvasLayout: parseEditorLayout(manifest.editor_layout),
```

Tolérant : entrées mal typées silencieusement ignorées (pas d'exception qui ferait planter l'import de tout le pack).

Helper extrait + exporté pour usage côté `bundles.ts` :

```ts
export function readEditorLayoutFromFiles(
  files: Record<string, string>,
  packId: string,
): Record<string, { x: number; y: number }> {
  const m = tryParse<ManifestYaml>(getFile(files, packId, "manifest.yaml")) ?? {};
  return parseEditorLayout(m.editor_layout);
}
```

### Backend — `backend/src/routes/bundles.ts` (plugin publish)

Logique actuelle (lignes 19-46) : si un `editorJson` non-stub existe, on le garde tel quel ; sinon on génère depuis les fichiers. Sous "files win", on doit **toujours** synchroniser `canvasLayout` avec ce que dit le manifest :

```ts
const incomingLayout = readEditorLayoutFromFiles(body.files, packId);

let editorJsonObj: Record<string, unknown>;
if (existing.length > 0 && !isEmptyStub(existing[0].editorJson)) {
  editorJsonObj = JSON.parse(existing[0].editorJson!);
} else {
  editorJsonObj = importPackFromFiles(packId, body.files);
}
editorJsonObj.canvasLayout = incomingLayout;  // files win

const keepEditorJson = JSON.stringify(editorJsonObj);
```

Effet observable :

- File copy serveur A → B avec positions dans manifest → republish plugin → `editorJson.canvasLayout` peuplé. Éditeur ouvert ensuite → positions correctes.
- File copy serveur A → B **sans** `editor_layout` (cas legacy ou champ retiré) → `canvasLayout: {}` → autoLayout grille par défaut.

### Backend — `backend/src/routes/editorSession.ts` (éditeur PUT/deploy)

Le PUT envoie `{ pack, files }`. `pack.canvasLayout` et `files.manifest.yaml.editor_layout` peuvent en théorie diverger (bug éditeur, race…). Application de la même règle "files win" :

```ts
const incomingLayout = readEditorLayoutFromFiles(body.files, packId);
const packObj = body.pack as Record<string, unknown>;
packObj.canvasLayout = incomingLayout;
const editorJson = JSON.stringify(packObj);
```

Une seule source à l'écriture, peu importe le chemin (plugin publish ou éditeur PUT).

### Plugin — aucun changement

`plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt:14` :
```kotlin
@JsonIgnoreProperties(ignoreUnknown = true)
data class ManifestYaml(...)
```
Le champ `editor_layout` est silencieusement ignoré au parse. Lors du republish via `BundleDownloader`, le fichier `manifest.yaml` est renvoyé tel quel (le plugin ne le sérialise jamais lui-même — il sert le binaire du disque).

## Tests

| Fichier | Cas |
|---|---|
| `editor/src/features/export/transform.test.ts` | (1) manifest contient `editor_layout` quand `canvasLayout` non-vide ; (2) ids fantômes (deleted menu) filtrés ; (3) champ omis dans manifest si `canvasLayout` est `{}`. |
| `backend/src/lib/packImport.test.ts` (nouveau ou étendu) | (1) `editor_layout` du manifest → `canvasLayout` ; (2) entrées mal typées (`x: "a"`, `null`) silencieusement ignorées ; (3) `editor_layout` absent → `canvasLayout: {}`. |
| `backend/src/routes/bundles.test.ts` | (1) Plugin republish avec positions → `editorJson.canvasLayout` overwrite ; (2) sans positions → `canvasLayout: {}` même si la DB avait des positions ; (3) stub editorJson → behave comme avant + positions du manifest. |
| `backend/src/routes/editorSession.test.ts` | PUT avec `pack.canvasLayout` divergent du manifest → le manifest l'emporte côté DB. |
| Round-trip (nouveau, ex. `backend/src/lib/packRoundTrip.test.ts` ou dans `transform.test.ts`) | `pack.canvasLayout` → `transform` → `importPackFromFiles` → égalité parfaite (modulo filtrage ids fantômes). |

## Risques / limites

- **Session éditeur ouverte sur server B + republish plugin pendant ce temps** : le `canvasLayout` chargé au démarrage de l'éditeur peut être écrasé. C'est cohérent avec le comportement du reste du bundle aujourd'hui (le plugin republish réécrit les menus/lang aussi). Acceptable.
- **Collision d'ids `MenuId == CommandId == DialogId`** : possible en théorie (espaces brandés mais pas disjoints au runtime). Le bug existe déjà dans `canvasLayout` aujourd'hui. Hors scope.
- **Taille du manifest** : un pack avec 100 menus ajoute ~100 lignes au manifest. Négligeable.

## Hors scope

- Zoom / pan / sélection courante de l'éditeur (état UI, pas du domaine).
- Ordre des layers d'un menu (déjà persisté ailleurs).
- Versioning ou historique des positions.
