# Structure d'un project sur disque

Les fichiers sont la **source de vérité** (ADR `files-first-source-of-truth`) : le disque est
lossless, l'éditeur n'a pas de représentation privilégiée.

```
plugins/Artisan/modules/
  <project_id>/
    artisan-module.yml             ← fichier de module (`schema: module/v1`), anciennement manifest.yaml
    menus/<menu_id>.yml            ← un dossier par kind de Document (cf. ci-dessous)
    commands/<command_id>.yml
    dialogs/<dialog_id>.yml
    <dossier>/                     ← dossier thématique (cf. ci-dessous), mêmes dossiers de kind
      menus/<menu_id>.yml
      dialogs/<dialog_id>.yml
      <sous-dossier>/menus/…       ← jusqu'à 3 niveaux
    lang/<lang>.yml                ← arborescence YAML (cf. ci-dessous)
    items/<captured_item_id>.yml   ← ItemStacks capturés (refs material `item:<id>`), YAML Bukkit verbatim
    data/<source_id>.yml           ← Project sources (schema data/v1, refs `pack:<id>`)
    templates/<id>.yml             ← schema template/v1, résolus au load plugin
    models/<id>.yml                ← schema model/v1 ; `<id>` = la source qu'il type (model possédé) sinon l'id du model, l'identité reste l'`id:` interne
    assets/{glyphs,textures,fonts}/ ← images et polices (binaires, écrits par la publication)
    .artisan/editor.yaml           ← état de la planche éditeur (seul `.artisan*` que l'éditeur écrit)
    .artisan/project-id            ← UUID du projet, écrit une fois par le plugin (garde Versions et brouillons à travers un renommage)
    .artisan/drafts/<id>/          ← brouillons d'avant la base de la suite, plus lus
    .artisan/transactions/         ← journal de publication, reçus dans `.receipts/`
    .artisan/history/              ← archives d'avant 2026-09-26, lues seulement
```

Avant 2026-10, la racine était `plugins/Artisan/projects/`. Au premier démarrage, le plugin la
déplace vers `modules/` (`ModulesRootMigration`) : chaque dossier garde son nom (namespace, refs
qualifiées) et son `.artisan/project-id` (Versions, brouillons), l'ancien dossier reste en
`projects.artisan-migrated/` et `modules/.artisan-migrations.yaml` empêche de rejouer la migration.
Un échec remet tout en place et garde `projects/`. Conception : `design-projets-en-modules.md`
(fichiers du projet), dont c'est le lot 1 ; le reste (éditeur par module, racines d'add-on) suit.

## Extensions YAML et fichier de module

Le plugin et l'éditeur écrivent `.yml` (la norme Bukkit/Paper) et lisent aussi `.yaml` (ce
qu'Artisan écrivait avant) partout : Documents, `lang/`, `data/`, `models/`, `templates/`, descripteurs d'`assets/`
(`model/YamlFiles.kt`, `lib/yamlFiles.ts`). Le même fichier sous les deux extensions est une
erreur : un Document est refusé (`duplicate_id`), un autre fichier est lu dans sa copie `.yml`
et le log nomme l'autre. Le fichier qui fait d'un dossier un module est `artisan-module.yml`
(`schema: module/v1`, mêmes champs que `manifest/v1`), lu en premier, puis `manifest.yml` et
`manifest.yaml` (`model/ModuleFile.kt`). `ProjectContentApi.read` trouve un fichier sous l'une ou
l'autre extension, et `read("manifest.yaml")` rend le fichier de module quel que soit son nom.
Une sauvegarde de l'éditeur réécrit chaque fichier sous l'extension qu'il a sur le disque
(`keepYamlExtensions`), un écran de configuration aussi.

Un fichier qui existe déjà est réécrit sous son nom : la copie d'un modèle ou d'un élément
système (`TemplateCopies`, `SystemFiles`), le fichier d'une commande de module
(`commands/<nom>.yml`), une publication de brouillon. Seul un fichier nouveau prend `.yml`
(`YamlFiles.onDisk`, côté éditeur `yamlPathFor`). Un modèle de module garde les noms sous
lesquels le module le livre (souvent `.yaml`) : l'éditeur compare ses fichiers à ceux du dossier
sans l'extension (`TemplateFileState.projectPath`), et `template_copy` accepte l'une ou l'autre
orthographe.

**Migration au démarrage** (`YmlMigration`, appelée par `ProjectRoots` quand le serveur démarre,
une fois par dossier et par démarrage) : chaque dossier de `plugins/Artisan/modules/` (le dossier
propre d'un module compris) voit ses `.yaml` renommés en `.yml` et son `manifest.yaml` en
`artisan-module.yml`, en un commit journalisé (`ProjectPublisher`), avec les clés de
`.artisan/origins.yaml`. Seuls les noms changent : les octets restent, un `manifest.yaml`
renommé garde `schema: manifest/v1` jusqu'à sa prochaine écriture par l'éditeur. Les
métadonnées `.artisan*` gardent leur nom. Un fichier dont la copie `.yml` existe déjà reste
tel quel, nommé dans le log. Une racine d'add-on hors de `modules/` et une racine de
configuration ne sont pas touchées : l'add-on y lit ses fichiers comme il les a écrits.

Un brouillon commencé avant la migration nomme encore `menus/shop.yaml` : l'éditeur, en le
reprenant (`followDisk`), renomme ses chemins comme le disque les écrit, et le plugin fait de
même à la publication (`DraftPublication`). Une modification faite sous l'ancien nom est donc
gardée, sans conflit.

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
`RuntimeProject.documents[kind]` (plugin). `menusOf(project)`, `runtime.menus` et leurs semblables
sont des accesseurs typés de **lecture** sur ce conteneur, jamais un second stockage. Un dossier
dont le kind n'est pas enregistré reste opaque : l'éditeur le round-trip dans
`moduleData.<dir>.__files`, le plugin ne le lit pas. Un kind enregistré par un module sans lecteur
core est lu en **document brut** (`RuntimeRawDocument` : le mapping YAML, `schema:` vérifié contre les
labels déclarés, le nom du fichier pour id) et rendu au module par
`ProjectContentApi.documents(projectId, kind)` (W6).

## Dossiers thématiques

Un module range ses Documents dans des dossiers libres qui mélangent les kinds :
`boutique/menus/shop.yaml`, `boutique/commands/shop.yaml`, `boutique/armes/menus/swords.yaml`.
La règle est une fonction pure des chemins, écrite deux fois et verrouillée par
`testdata/document-layout-conformance.json` : `model/DocumentLayout.kt` (plugin, lu par
`ProjectReader` et `ResourceInventory`) et `domain/documentLayout.ts` (éditeur, lu par
`projectFromFiles`, `adoptLateDocuments` et `projectToFiles`).

- Un Document est `<dossiers…>/<dir du kind>/<id>.yaml` (ou `.yml`), avec 0 à 3 dossiers thématiques
  (slug `^[a-z0-9][a-z0-9_-]*$`).
- **L'id reste le nom du fichier.** Le dossier n'entre ni dans l'id, ni dans les références,
  ni dans les clés `lang/` ou de planche : déplacer un Document ne change que son chemin.
  L'éditeur le porte dans `Document.folder` et un renommage enregistre le déplacement sous
  le dossier du Document (`renamedDocumentFiles`).
- **Un id est unique par kind dans le module.** Deux fichiers du même kind et du même id,
  dans deux dossiers : les deux sont refusés (`duplicate_id`). Deux kinds peuvent partager
  un id (un menu et une commande `shop`) : `.artisan/editor.yaml` range alors la planche
  (`layout`, `edges`) par `<kind>/<id>`, et l'éditeur signale ce partage à l'ouverture.
- Un dossier de kind ne contient que des fichiers (`kind_dir_subfolder` sinon). Un dossier
  thématique ne peut pas porter le nom d'une ressource (`lang`, `items`, `data`, `models`,
  `templates`, `assets`, `overrides`, `config` : `reserved_folder`) ni dépasser 3 niveaux
  (`too_deep`). Les ressources restent à la racine du module.
- Un fichier refusé est signalé (`onSkip`, côté plugin) et jamais perdu : l'éditeur le garde
  dans `Project.unreadFiles` et le réécrit tel quel. Ce qui n'a pas la forme d'un Document
  (fichier posé directement dans un dossier thématique, dossier de kind non enregistré)
  reste dans `moduleData.<premier dossier>.__files`, et `adoptLateDocuments` le lit quand
  le kind arrive.
- Dans l'éditeur, l'arbre de la barre latérale crée, renomme, supprime les dossiers et y
  déplace les Documents ; sur la planche, chaque dossier de premier niveau est un cadre.
  `.artisan/editor.yaml` garde sous `folders:` la couleur et la position de ces cadres, et
  les dossiers encore vides (rien d'autre sur le disque ne s'en souviendrait) :
  `folders: { boutique: { color: "#a855f7", position: { x: 120, y: 240 } }, vide: {} }`.

Les fichiers `data/` portent les Data models **inlinés** ; les valeurs `ltext` sont des clés i18n
résolues au bind, les valeurs item des refs material.

Les chemins dont le **premier segment** commence par `.artisan` sont hors hash et
invisibles au scan disque — cf. `invariants.md` § Exclusion `.artisan*` universelle. Idem pour
`.artisan-trash/`, au top de `projectsDir`.

## Fichier de module — `lore_max_width`

Largeur max d'une ligne de lore, en **pixels MC** (avances de la police vanilla, +1 px par caractère
gras ; ~6 px par caractère courant). Absent ou `0` = pas de retour à la ligne ; les projets créés
depuis l'éditeur naissent avec `240`. Le plugin découpe chaque ligne **après** résolution des
placeholders (`render/LoreWrap.kt`), l'aperçu éditeur applique le même algorithme
(`lib/loreWrap.ts`) — contrat figé par `testdata/lore-wrap-conformance.json`. On coupe sur les
espaces, un mot trop long déborde seul, et une ligne de continuation rouvre les balises
MiniMessage encore ouvertes (chaque ligne de lore est parsée seule). Le lore de l'item de base
n'est pas redécoupé, sauf placé par `{base.lore}`. Réglable dans les paramètres du projet
(bouton YAML = le fichier de module verbatim).

## Fichier de module — `escape_goes_back`

Booléen, absent = `false`. Vrai : Échap dans un menu du projet rouvre l'écran précédent de la pile
de navigation (comme `open_previous_menu`) au lieu de la vider ; pile vide = fermeture normale.
Seule la raison de fermeture `PLAYER` déclenche le retour — `close_menu` (`PLUGIN`) ferme tout.
Câblé dans `listener/MenuListener.kt` (tick suivant, comme le vidage d'historique). Les dialogs ne
sont pas concernés.
Spigot ne donne pas la raison de fermeture (`MenuCloseReason.UNKNOWN`) : le retour n'y joue pas.

## `lang/` — arborescence, pas fichier plat

Chaque `.` de la clé est un niveau (`menus:` → `<menu_id>:` → `elements:` → …). Le runtime adresse
par clé pointée.

- **Codec d'écriture** (seul writer) : `editor/src/lib/langTree.ts` — `nestLangTree`.
- **Miroir de lecture** : `plugin/…/yaml/LangFlattener.kt`.
- **Verrouillé par** le vecteur partagé `testdata/lang-tree-conformance.json`.

Les trois readers (plugin, import éditeur, mutation module) acceptent **arbre / plat legacy /
mélange** — rien à migrer. Une clé bloquée par une feuille (`a.b` et `a.b.c` coexistent) reste
pointée à la racine plutôt que perdue.

Une clé de `lang/` qu'aucun Document ni aucune data source du module ne lit à l'import est
**gardée telle quelle** : les messages d'un add-on (ArtisanAuctions, un bundle déclaré
`inFolder`), une clé ajoutée par l'admin. L'éditeur la note dans `Project.keptLangKeys`
(`projectFromFiles`) et la réécrit depuis `i18nKeys` à chaque export (`keptLangEntries`) : une
modification dans Traductions s'applique, une suppression l'enlève, une clé qu'un site possède
entre-temps lui revient. Les clés sous `menus.`, `commands.`, `dialogs.`, `sources.` et
`artisan.` restent à l'éditeur. Avant, un export ne gardait que les clés sans site et les data
sources : un Déployer effaçait le reste.

Un add-on range ses **messages système** dans le `lang/` de son dossier avec
`MessageBundleDeclaration.files(...).inFolder(dossier)` (API 2.17.0) : Artisan y lit les
fichiers du serveur à la place de `plugins/<Plugin>/lang/`, les y déplace une fois
(`LangFolderMove`, un fichier dont la langue existe déjà dans le dossier reste et le log le
nomme), et relit le bundle à chaque rechargement des projets (`Translations.reloadFolderBundles`).
Le jar répond toujours pour les clés absentes.

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

Un **lore** traduit est une liste de lignes **par langue** (`lore: { en: [...], fr: [...] }`) :
chaque langue a son propre nombre de lignes et le fallback (langue demandée → `defaultLang` →
n'importe laquelle) porte sur le bloc entier. Sans traduction, c'est une simple liste de lignes.
La forme « une map `{lang: texte}` par ligne » reste lue (plugin `LoreDeserializer`, éditeur
`menuV1ToDomain.loreText`, qui la regroupe en un bloc par langue) mais n'est plus écrite
(`schema/fieldText.ts` `loreWire`).

## Champ `title` d'un menu

Un `MenuTitleLayer[]` — `background` / `glyph` / `text` / `textarea` / `external_glyph`. Format YAML
et pipeline de rendu pixel-perfect (pixel offsets, fonts custom) : `editor-internals.md`.
