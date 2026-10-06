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

## `manifest.yaml` — `lore_max_width`

Largeur max d'une ligne de lore, en **pixels MC** (avances de la police vanilla, +1 px par caractère
gras ; ~6 px par caractère courant). Absent ou `0` = pas de retour à la ligne ; les projets créés
depuis l'éditeur naissent avec `240`. Le plugin découpe chaque ligne **après** résolution des
placeholders (`render/LoreWrap.kt`), l'aperçu éditeur applique le même algorithme
(`lib/loreWrap.ts`) — contrat figé par `testdata/lore-wrap-conformance.json`. On coupe sur les
espaces, un mot trop long déborde seul, et une ligne de continuation rouvre les balises
MiniMessage encore ouvertes (chaque ligne de lore est parsée seule). Le lore de l'item de base
n'est pas redécoupé, sauf placé par `{base.lore}`. Réglable dans les paramètres du projet
(bouton YAML = `manifest.yaml` verbatim).

## `manifest.yaml` — `escape_goes_back`

Booléen, absent = `false`. Vrai : Échap dans un menu du projet rouvre l'écran précédent de la pile
de navigation (comme `open_previous_menu`) au lieu de la vider ; pile vide = fermeture normale.
Seule la raison de fermeture `PLAYER` déclenche le retour — `close_menu` (`PLUGIN`) ferme tout.
Câblé dans `render/MenuListener.kt` (tick suivant, comme le vidage d'historique). Les dialogs ne
sont pas concernés.

## `lang/` — arborescence, pas fichier plat

Chaque `.` de la clé est un niveau (`menus:` → `<menu_id>:` → `elements:` → …). Le runtime adresse
par clé pointée.

- **Codec d'écriture** (seul writer) : `editor/src/lib/langTree.ts` — `nestLangTree`.
- **Miroir de lecture** : `plugin/…/yaml/LangFlattener.kt`.
- **Verrouillé par** le vecteur partagé `testdata/lang-tree-conformance.json`.

Les trois readers (plugin, import éditeur, mutation module) acceptent **arbre / plat legacy /
mélange** — rien à migrer. Une clé bloquée par une feuille (`a.b` et `a.b.c` coexistent) reste
pointée à la racine plutôt que perdue.

## Textes structurels — field-local (ADR `field-local-translations`)

Depuis 2026-09-30, les textes **structurels** (titre de menu, `title`/`lore` d'apparence, `title`/
`body`/labels de dialog) vivent **dans le document**, pas dans `lang/`. Un slot texte est soit une
**string** (littéral, ou ref `{i18n:key}`, identique pour toutes les langues), soit une **map
field-local `{ <lang>: texte }`** (résolue langue demandée → `defaultLang` → n'importe quelle entrée).
La forme string est un sucre pour `{<defaultLang>: texte}`. Un champ structurel n'est jamais à la
fois string et map.

`lang/` ne porte donc plus que : les **textes d'action** (sérialisés en refs `@key` à l'intérieur de
l'Action DSL — une string DSL ne peut pas contenir de map), les **clés sans site** de présentation
(`artisan.duration.*`) et les **adresses des data sources** (ADR `bare-data-files` ④). En
conséquence, le sous-système d'**adresses positionnelles** (`I18nAddresses.kt` côté plugin,
`i18nKeys.ts`/`i18nSites.ts` côté éditeur) n'est plus un contrat de rendu pour les documents —
le runtime lit la map du slot. Vecteur retiré : `testdata/i18n-address-conformance.json`.

`title: "Retour"` et `title: { fr: Retour, en: Back }` coexistent ; un champ string est lu comme la
valeur du `defaultLang` (donc détecté comme non traduit pour les autres langues). Migration
paresseuse : un projet inline mono-langue se lit à l'identique, la promotion string → map ne se fait
qu'à la saisie d'une deuxième langue. La lecture reste tolérante à l'ancienne forme adressée.

## Champ `title` d'un menu

Un `MenuTitleLayer[]` — `background` / `glyph` / `text` / `textarea` / `external_glyph`. Format YAML
et pipeline de rendu pixel-perfect (pixel offsets, fonts custom) : `editor-internals.md`.
