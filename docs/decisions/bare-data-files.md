# ADR : Fichiers de données nus — le schéma vit à côté, jamais dedans

**Statut** : accepté (2026-07-26)
**Contexte amont** : `composable-data-models.md` (décision ③ révisée),
`project-sources-and-data-models.md` (les deux shapes unifiés),
`files-first-source-of-truth.md` (P2b « models ignorés plugin » inversé).

## Contexte

Le format data/v1 mélangeait **définition** (`fields:`) et **valeurs** dans le
même fichier, minté des clés ltext même en mono-langue, et imposait un header
(`schema`/`id`/`shape`). Un réglage d'une ligne pesait 9 lignes de cérémonie.
Pour un écosystème Minecraft où le YAML édité main est la norme culturelle,
c'est un repoussoir — et l'ancre de confiance « ta config marche sans nous »
exige que la porte de sortie fichiers soit *agréable*, pas juste possible.
Constat déclencheur : la déclaration d'un model vit dans le **JAR** de
l'add-on (pas dans le backend), et `models/<id>.yaml` existe déjà — le contrat
offline n'a jamais eu besoin du schéma *inline dans le fichier de données*,
seulement *sur le même disque ou dans le même JAR*.

## Décisions

**① Précédence de résolution du schéma** : `fields:` inline > déclaration JAR
(source d'add-on) > `models/<id>.yaml` (source project-authored) > fallback
untyped. Premier trouvé gagne, les autres sont ignorés silencieusement (jamais
d'erreur — philosophie non-hermétique). L'inline n'est **plus jamais écrit**
par nos outils mais reste lu à vie.

**② Une source = une valeur typée (shapes unifiés)** : la distinction
Table/Config disparaît. Racine **objet** → interpolation (`{pack:id.champ}`),
form simple. Racine **liste de model** → itérable, plaçable, cible de Set,
`key_field` (défaut `id`), master-detail. `key_field`, `granularity` et
`order` sont des propriétés du **kind liste racine**, plus d'un shape.
Détection d'un fichier nu : mapping YAML = objet, liste YAML = liste ; le
schéma résolu ailleurs prime s'il existe. `shape: table|config` = alias legacy
lu, jamais écrit. L'UI éditeur (spreadsheet vs form) se **dérive** du kind
racine. Un `iterates.source` vers une source non-liste itère vide, silencieux.

**③ Header optionnel** : `schema:`/`id:`/`shape:`/`fields:` restent honorés
s'ils sont présents (un fichier commençant par `schema: data/v1` est la forme
legacy) ; sinon le fichier est pur valeurs, `id` dérive du filename, `name`
de l'id. En per-row, `_source.yaml` devient optionnel : absent → rows = tous
les `.yaml` du dossier triés par filename ; présent → il ne porte plus que
`order:` (+ overrides).

**④ ltext = contrat hybride, comme les menus** : une valeur ltext sur disque
est **le texte littéral de la langue par défaut** (`name: "Armes"`). Les
autres langues vivent dans `lang/<lang>.yaml` sous les clés key-site
(l'adresse ne change pas). Une valeur qui matche une clé présente dans `lang/`
se résout encore (tolérance) ; sinon elle est littérale. Mono-langue = zéro
clé, zéro `lang/`.

**⑤ L'éditeur n'écrit que la forme nue** : source liée à un model déclaré →
fichier pur valeurs ; source project-authored → schéma dans `models/<id>.yaml`
+ fichier data nu (créer une source émet les deux). Un fichier legacy importé
est re-canonicalisé à la sauvegarde suivante. **Corollaire : le plugin lit
`models/` au load** pour typer les sources project-authored (walk ltext) —
même mouvement que la résolution des templates (P2a), toujours offline.
« Models ignorés par le plugin » (P2b) est révoqué.

**⑥ Pas de re-migration de l'existant** : les projects déjà en forme verbeuse
restent tels quels (readers tolérants à vie) ; la re-canonicalisation arrive
naturellement à la prochaine sauvegarde éditeur. `ShopDataMigrator` produit la
forme nue pour les futures migrations `shop.yaml` (et garde `granularity:
row`, choix boutique).

**⑦ Commentaires** : l'export **projette les hints du model en commentaires
YAML** (`help`/`label` → `# …` au-dessus du champ) + un en-tête généré
(`# Géré par Artisan — éditable à la main`), régénérés à chaque export (pas de
préservation nécessaire) ; un **bloc de commentaires d'en-tête écrit main**
est capturé au parse et ré-émis verbatim. L'aide écrite une fois dans le model
sert le form (tooltip) et le fichier (commentaire). **Défer** : préservation
de commentaires arbitraires au milieu des fichiers (AST comment-aware
généralisé).
> **Précisé et durci par l'ADR `yaml-assisted-editing` (2026-07-27)** : le
> défer devient un **refus** — les commentaires écrits main ne sont jamais
> préservés (le patch chirurgical a été examiné puis rejeté), et l'en-tête
> généré doit le **dire**. Le placement « au-dessus du champ » décrit ici doit
> être appliqué tel quel : le code les regroupait en bloc d'en-tête. Côté
> formulaire, l'aide cesse d'être une infobulle et devient visible sous le
> champ, le nom technique restant affiché à côté du libellé.

## Conséquences

- `data/v1` reste v1 : toute forme existante reste valide, on n'ajoute que
  des formes plus courtes (relaxation tolérante ; la discipline « nouveau
  dossier » vise les breaks).
- `CONTEXT.md` § Data source : « deux shapes » remplacé par « une valeur
  typée ; racine liste ⇒ itérable/plaçable ».
- Un `shop_settings.yaml` retombe à `whole_shop_discount: 0` ; un catalogue
  écrit main redevient aussi simple qu'un `shop.yaml` classique, mais typé,
  éditable dans le form généré, multi-langue à la demande.

## Alternatives rejetées

- **Garder le schéma inline obligatoire** (décision ③ d'origine) : le contrat
  offline n'en a pas besoin — JAR et `models/` sont sur le même disque.
- **Re-migrer l'existant en masse** : risque sur données saines, zéro gain.
- **`data/v2`** : rien ne casse, la tolérance suffit.
