# Structure d'un project sur disque

Les fichiers sont la **source de vérité** (ADR `files-first-source-of-truth`) : le disque est
lossless, l'éditeur n'a pas de représentation privilégiée.

```
plugins/Artisan/projects/
  <project_id>/
    manifest.yaml
    menus/<menu_id>.yaml           ← un dossier par kind de Document (cf. ci-dessous)
    commands/<command_id>.yaml
    dialogs/<dialog_id>.yaml
    lang/<lang>.yaml               ← arborescence YAML (cf. ci-dessous)
    items/<captured_item_id>.yml   ← ItemStacks capturés (refs material `item:<id>`), YAML Bukkit verbatim
    data/<source_id>.yaml          ← Project sources (schema data/v1, refs `pack:<id>`)
    templates/<id>.yaml            ← schema template/v1, résolus au load plugin
    models/<id>.yaml               ← schema model/v1, ignorés par le plugin
    assets/{glyphs,textures,fonts}/ ← images et polices (binaires, écrits par la publication)
    .artisan/editor.yaml           ← état de la planche éditeur (seul `.artisan*` que l'éditeur écrit)
    .artisan/project-id            ← UUID du projet, écrit une fois par le plugin (garde Versions et brouillons à travers un renommage)
    .artisan/drafts/<id>/          ← brouillons d'avant la base de la suite, plus lus
    .artisan/transactions/         ← journal de publication, reçus dans `.receipts/`
    .artisan/history/              ← archives d'avant 2026-09-26, lues seulement
```

Un Project s'identifie par le nom de son dossier sur son serveur ; pour le hub et l'éditeur, il
s'appelle `<server id>.<dossier>`, quel que soit le serveur (cf. `entities.md`). `.artisan-sync.yaml` (ancienne
métadonnée de synchro cloud) peut subsister sur un vieux serveur : il reste exclu et ignoré.

## Dossiers de Documents — le registre des kinds

Les dossiers `menus/`, `commands/` et `dialogs/` ne sont nommés nulle part en dur (ADR
`extensible-document-kinds`, décision 10). Chaque **kind** de Document est une entrée d'un registre
— `editor/src/domain/documentKinds.ts` (`kind`, `dir`, `idPrefix`, `schemaVersion`, `rank`) et
`plugin/core/.../model/DocumentKinds.kt`, façade Kotlin du `DocumentKindRegistry` de l'API
(`kind`, `dir`, `schemaVersions`, `idPrefix` ; les kinds core y sont enregistrés par
`coreRegistry()`, un module ajoute les siens par `api.getDocumentKinds()`) — et tout ce qui parcourt
un projet boucle sur ce registre : l'import (`projectFromFiles`) et l'écriture (`projectToFiles`) de
l'éditeur via les codecs par kind (`schema/documentCodecs.ts`, un lecteur `<kind>V1ToDomain` et un
écrivain `<kind>V1FromDomain` par kind), le `ProjectReader` du plugin via
un lecteur par kind, l'inventaire de ressources et les tables de références du provider.

En mémoire, un Project est un **conteneur unique** : `Project.documents[kind]` (éditeur) et
`ProjectBundle.documents[kind]` (plugin). `menusOf(project)`, `bundle.menus` et leurs semblables
sont des accesseurs typés de **lecture** sur ce conteneur, jamais un second stockage. Un dossier
dont le kind n'est pas enregistré reste opaque : l'éditeur le round-trip dans
`moduleData.<dir>.__files`, le plugin ne le lit pas. Un kind enregistré par un module sans lecteur
core est lu en **document brut** (`BundleRawDocument` : le mapping YAML, `schema:` vérifié contre les
labels déclarés, le nom du fichier pour id) et rendu au module par
`ProjectContentApi.documents(projectId, kind)` (W6).

Les fichiers `data/` portent les Data models **inlinés** ; les valeurs `ltext` sont des clés i18n
résolues au bind, les valeurs item des refs material.

Les chemins dont le **premier segment** commence par `.artisan` sont hors hash et
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
