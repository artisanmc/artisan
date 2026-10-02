# Traductions locales au champ — le Document porte ses langues

**Status:** proposed (2026-09-30)

## Contexte

Le modèle i18n actuel (ADR `files-first-source-of-truth` §4, amendements
2026-07-30 et 2026-08-03) stocke les traductions **par projet**, dans
`lang/<lang>.yaml`, keyées par **adresse canonique dérivée de la position**
(`menus.shop.elements.buy.default.title`). Deux modes coexistent : `extract`
(clés `{i18n:key}` dans les documents, toutes les langues dans `lang/`) et
`inline` (littéral de la langue par défaut dans le document, les autres langues
dans `lang/` à l'adresse du site). L'adresse est mint côté éditeur
(`domain/i18nSites.ts`, `lib/i18nKeys.ts`) et recalculée côté plugin
(`engine/I18nAddresses.kt`, `MenuTitleParser`, `DialogTextResolver`), les deux
implémentations verrouillées par `testdata/i18n-address-conformance.json`.

Deux problèmes motivent ce changement :

- **Portabilité d'un Document.** Copier un menu d'un serveur à l'autre (FTP,
  export, partage) perd ses traductions, noyées dans le `lang/` du projet ; comme
  les clés sont project-scoped et position-dérivées, il faut aussi les
  ré-adresser dans la cible. Or le Document est l'unité qu'on partage.
- **Lisibilité / édition à la main.** Le contenu d'un menu et ses traductions
  vivent dans deux fichiers (voire trois formes) qu'un admin qui édite sur disque
  doit réconcilier mentalement.

Contrainte de déploiement : Artisan tourne en prod sur un serveur, **mono-langue,
en mode inline**. La bascule doit se faire sans migration de fichiers ni rupture.

L'ADR `files-first-source-of-truth` §4 avait déjà **différé** un « bloc
`translations:` inline par document » au motif qu'il exigeait une dérivation de
clé positionnelle fragile. Le présent ADR retient une **autre forme** — la
traduction est portée **au champ** (au Key site), sans aucune adresse — qui
élimine précisément cette fragilité.

## Décision

1. **Un slot texte porte ses langues sur disque.** La forme d'un texte devient
   `string | Record<LangCode, string>` (et pour les listes
   `string[] | Record<LangCode, string[]>`). Les langues d'un Document vivent
   dans le Document.

   ```yaml
   title: "Retour"                    # sucre pour {<defaultLang>: "Retour"}
   title: { fr: "Retour", en: "Back" } # map explicite
   title: "{i18n:common.close}"        # échappatoire vers le store partagé
   ```

2. **Un string nu est un sucre pour `{<defaultLang>: littéral}`.** C'est la
   sémantique du mode inline actuel : le littéral est la valeur de la langue par
   défaut, les autres langues sont manquantes et donc **détectées**
   (`isTranslationMissing`). *Rejeté :* « un string = valeur universelle pour
   toutes les langues » — même rendu runtime, mais le trou de traduction ne
   remonterait jamais.

3. **Résolution par champ :** langue demandée → `defaultLang` → littéral. Un
   `{i18n:key}` (string) reste résolu contre le `lang/` projet et est la seule
   échappatoire vers une clé partagée. Trois formes coexistent par champ —
   littéral local, map locale, ref globale — **jamais** un champ à la fois
   string et map.

4. **Désambiguïsation par type, pas par contenu.** Les Key sites forment un
   ensemble fermé (traversée unique `i18nSites.ts` / `I18nAddresses.kt`) : le
   parser sait *a priori* quels champs sont des textes. Dans un slot texte, toute
   map est une lang-map ; ses clés doivent être des `LangCode` valides, sinon la
   valeur est invalide. Pas d'heuristique de forme.

5. **Le sous-système d'adresses positionnelles est retiré pour les documents.**
   Les adresses n'existaient que pour rattacher les traductions non-default
   stockées dans `lang/` à des littéraux anonymes du mode inline. Les champs
   structurels portant désormais leurs langues, plus rien n'a besoin d'être
   adressé au runtime.

6. **Les textes d'action vivent dans la string DSL, donc restent des refs
   explicites.** `send_message`, `broadcast`, `show_title` et les `name`/`lore` de
   `give_item` sont sérialisés à l'intérieur de l'Action DSL (`ClickHandlerYaml.steps:
   String`), où un argument texte est soit un littéral `"..."`, soit une ref
   `@key` (`actiondsl/Ast.kt`). On **ne peut pas** y loger une map de langues.
   Décision (option A) : l'éditeur émet les textes d'action en **refs `@key`
   explicites** (`{i18n:key}` après bridge DSL), leurs valeurs vivant dans
   `lang/`. Plus d'adresse positionnelle, mais les messages d'action **ne sont
   pas** emportés par la copie d'un document — gap assumé, à rouvrir dans une
   tâche dédiée (sortir les textes d'action de la string DSL).

   > **Rouvert et résolu le 2026-09-30** par l'ADR `structured-action-wire` : le
   > wire d'action devient **structuré (YAML keyed par nom)**, donc un texte
   > d'action est un **`LocalizedText` inline** comme les textes structurels, et
   > le DSL redevient une simple vue d'édition. La présente décision 6 décrit
   > l'état intermédiaire (option A) ; la cible est le wire structuré. **Portée data
   sources :** inchangée, elles gardent l'adressage positionnel (ADR
   `bare-data-files` ④), une lang-map en cellule de table se battrait avec le
   modèle de données.

7. **Migration paresseuse, zéro rupture.** Les littéraux inline existants sont
   lus comme `{defaultLang: littéral}` ; les projets `extract` continuent via
   `{i18n:key}`. Aucun fichier à migrer, aucun re-adressage. La promotion
   string → map ne se produit qu'au moment où l'on saisit une deuxième langue.
   Les clés sans site (`artisan.duration.*`) restent dans `lang/`.

*Rejeté à la racine :* un bloc `translations:` par document avec des adresses à
l'intérieur — il réintroduirait le matching d'adresses **dans** le fichier **et**
un second store (le pire des deux). La forme champ-local l'évite.

## Conséquences

- **Éditeur** — `LText { key }` (`domain/types.ts`) devient
  `LocalizedText = string | Record<LangCode, string> | { i18n: I18nKey }`.
  `Project.i18nKeys` / `getText` / `setLText` ne servent plus qu'aux clés
  **référencées** (partagées) ; `i18nSites.ts` perd le rekey/mint/release au
  profit d'accès directs ; `transform.ts` (`textSerializer`, `serializeLang`) et
  `projectFromFiles.ts` (`readTranslations`) gèrent la forme union.
- **Plugin** — les champs texte des modèles YAML (`AppearanceYaml.title/lore`,
  labels dialog, `LText` des title layers) deviennent un type valeur portant
  `string | map` ; `resolveText`/`resolve` perdent le paramètre `address` ;
  `I18nAddresses.kt` et le stamping de `MenuTitleParser` sont retirés pour les
  documents. Lecture **tolérante** : l'ancienne forme adressée reste lue le temps
  de la bascule.
- **Vecteurs / codecs** — `testdata/i18n-address-conformance.json` est retiré
  pour les documents (conservé pour les data sources si applicable) ; le codec
  `langTree` (`nestLangTree`/`LangFlattener`) reste nécessaire aux refs et aux
  data sources.
- **Portabilité** : copier un Document emporte ses traductions. Ajouter une
  langue = passe bulk sur les documents (outillage « scan des manquants » +
  import), plus un fichier à créer.
- **IA / traduction** : un Document est auto-suffisant (structure + textes + tous
  les langages) ; le `lang/` global reste une **vue agrégée dérivée** pour les
  jobs de traduction, sans être canonique.
- **Doc impact** : `docs/architecture/project-files.md` (layout `lang/`),
  `docs/architecture/editor-internals.md` (§ i18n `extract`/`inline`),
  `docs/decisions/files-first-source-of-truth.md` §4 (amendement),
  `CONTEXT.md` (LText, Key site), `docs/schema/menu/v1` + `dialog/v1`.
- **Amende** l'ADR `files-first-source-of-truth` §4 : le « bloc `translations:`
  différé » est remplacé par des traductions **au champ**, et l'inline devient un
  point de départ migré paresseusement, pas un mode maintenu indéfiniment.
