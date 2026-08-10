# Structure d'un project sur disque

Les fichiers sont la **source de vérité** (ADR `files-first-source-of-truth`) : le disque est
lossless, l'éditeur n'a pas de représentation privilégiée.

```
plugins/Artisan/projects/
  <project_id>/
    manifest.yaml
    menus/<menu_id>.yaml
    dialogs/<dialog_id>.yaml
    lang/<lang>.yaml               ← arborescence YAML (cf. ci-dessous)
    items/<captured_item_id>.yml   ← ItemStacks capturés (refs material `item:<id>`), YAML Bukkit verbatim
    data/<source_id>.yaml          ← Project sources (schema data/v1, refs `pack:<id>`)
    templates/<id>.yaml            ← schema template/v1, résolus au load plugin
    models/<id>.yaml               ← schema model/v1, ignorés par le plugin
    .artisan-sync.yaml             ← SyncMetadata (syncedHash, backendHash, syncedAt)
    .artisan/editor.yaml           ← état de la planche éditeur
```

Les fichiers `data/` portent les Data models **inlinés** ; les valeurs `ltext` sont des clés i18n
résolues au bind, les valeurs item des refs material.

Les chemins dont le **premier segment** commence par `.artisan` sont hors hash, jamais uploadés et
invisibles au scan disque — cf. `invariants.md` § Exclusion `.artisan*` universelle. Idem pour
`.artisan-trash/`, au top de `projectsDir`.

## `lang/` — arborescence, pas fichier plat

Chaque `.` de la clé est un niveau (`menus:` → `<menu_id>:` → `elements:` → …). Le runtime adresse
par clé pointée.

- **Codec d'écriture** (seul writer) : `editor/src/lib/langTree.ts` — `nestLangTree`.
- **Miroir de lecture** : `plugin/…/yaml/LangFlattener.kt`.
- **Verrouillé par** le vecteur partagé `testdata/lang-tree-conformance.json`.

Les trois readers (plugin, import éditeur, mutation module) acceptent **arbre / plat legacy /
mélange** — rien à migrer. Une clé bloquée par une feuille (`a.b` et `a.b.c` coexistent) reste
pointée à la racine plutôt que perdue.

Le mode d'inlining (littéral de la langue par défaut dans le document, autres langues à l'adresse
canonique dans `lang/`) est redérivé côté Kotlin par `I18nAddresses.kt` et verrouillé par
`testdata/i18n-address-conformance.json`.

## Champ `title` d'un menu

Un `MenuTitleLayer[]` — `background` / `glyph` / `text` / `textarea` / `external_glyph`. Format YAML
et pipeline de rendu pixel-perfect (pixel offsets, fonts custom) : `editor-internals.md`.
