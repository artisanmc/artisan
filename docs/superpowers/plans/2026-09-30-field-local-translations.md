# Traductions locales au champ

Statut : en cours (2026-09-30) — Phase 0 (schémas) + Phase 3 (runtime plugin) + import/export éditeur livrés, suites plugin et éditeur vertes. Restent : Phase 3b (retirer l'adressage positionnel structurel côté éditeur + `i18nMode`) et Phase 5 (outillage « ajouter une langue » + docs user).
ADR de référence : `docs/decisions/field-local-translations.md`.

## Objectif et décisions

- Un slot texte sur disque devient `string | Record<LangCode, string>` (listes :
  `string[] | Record<LangCode, string[]>`). Le Document porte ses langues.
- Un string nu = sucre pour `{<defaultLang>: littéral}` (sémantique inline
  actuelle ; la détection de traduction manquante continue de fonctionner).
- Résolution par champ : langue demandée → `defaultLang` → littéral.
  `{i18n:key}` reste l'échappatoire vers le `lang/` projet (clés partagées).
- Désambiguïsation par type : les Key sites sont un ensemble fermé, donc un map
  dans un slot texte = lang-map. Pas d'heuristique de contenu.
- Le sous-système d'adresses positionnelles est retiré pour menus / commandes /
  dialogs ; il reste en vigueur pour les data sources (`bare-data-files` ④).
- Migration **paresseuse** : lecture tolérante de l'ancien mode inline, aucune
  réécriture ni re-adressage ; promotion string → map à la saisie d'une 2ᵉ langue.
- Contrainte prod : un serveur, mono-langue, inline → la bascule ne doit rien
  casser.

## Phase 0 — Schéma et types (tests d'abord)

1. Étendre `docs/schema/menu/v1` et `dialog/v1` : les slots texte passent en
   `oneOf: [string, object]` (valeurs `LangCode` → string MiniMessage) ; les
   listes en `oneOf: [array<string>, object]`. Aligner les fixtures.
2. Aligner `editor/src/schema/validateMenuV1` (+ types) et les exemples sur la
   nouvelle union.
3. Définir `LocalizedText` dans `domain/types.ts` à côté de `LText`, et le
   garder rétro-compatible (LText = forme interne pour les clés référencées).

Vérification : fixtures mono-langue, multi-langue, ref `{i18n:key}` et map mixte
valident ; un map dont une clé n'est pas un `LangCode` échoue. Garde : ne pas
casser les fixtures existantes (rétro-compat string).

## Phase 1 — Domaine éditeur (tests d'abord)

1. Écrire les tests de lecture/écriture d'un `LocalizedText` (get/set par langue,
   repli `defaultLang`, détection manquant) avant de modifier `lib/i18n.ts`.
2. Introduire `LocalizedText` dans les champs texte des entités (menus,
   commands, dialogs) ; `getText`/`setLText` deviennent les accesseurs
   polymorphes (string | map | ref).
3. Simplifier `domain/i18nSites.ts` : les slots texte locaux ne mintent plus de
   clé ; les générateurs `rekey*`/`mint*`/`release*` ne s'appliquent plus qu'aux
   clés **référencées** et aux data sources. Conserver la traversée unique comme
   point d'entrée.
4. Adapter le store (`state/accountStore.ts`) : `addLanguage` itère la passe
   bulk (les documents sont la source), `setI18nValue` écrit dans le
   `LocalizedText` local ou dans `i18nKeys` selon la forme.

Vérification : les suites `lib/i18n.test.ts`, `domain/i18nSites.test.ts`,
`state/accountStore` couvrent lecture multi-langue, repli, ajout de langue.
Garde : aucun site de clé ne doit fuiter une clé mintée pour un texte local.

## Phase 2 — Import / export éditeur (tests d'abord)

1. `schema/projectFromFiles.ts` : `readTranslations` ne collecte plus que les
   clés référencées + data sources ; les maps de langues sont lues au slot.
   `adoptAddressedTranslations` devient une **migration** (inline adressé → map
   locale), exécutée une fois à l'ouverture d'un ancien projet.
2. `features/export/transform.ts` : `textSerializer` émet `string` (mono-langue)
   ou `map` (multi) ; `serializeLang` ne produit plus que les clés référencées,
   les data sources et les clés sans site (`artisan.duration.*`).
3. Conserver/ajouter le test de point fixe round-trip (`serialize*` / `*ToDomain`)
   sur des projets mono et multi-langue, y compris un ancien projet inline.

Vérification : round-trip idempotent ; un ancien projet inline se lit puis se
ré-écrit sans perte et sans re-adressage. Garde : ne pas supprimer les clés
référencées encore utilisées ; préserver `testdata/lang-tree-conformance.json`.

## Phase 3 — Runtime plugin (tests d'abord)

1. Étendre les tests de `MenuTitleParser`, `MenuRenderer`, `ActionExecutor`,
   `DialogTextResolver` sur les trois formes de champ et le repli de langue.
2. Introduire un type valeur `LocalizedText` (string | map) dans les modèles YAML
   (`AppearanceYaml.title/lore`, labels dialog, `LText` des title layers).
3. Retirer le paramètre `address` de `resolveText`/`resolve` ; la résolution
   devient langue → defaultLang → littéral, plus la branche `{i18n:key}`.
4. Retirer le stamping d'adresse de `MenuTitleParser` et le sous-système
   `engine/I18nAddresses.kt` pour les documents ; laisser les data sources telles
   quelles (`ProjectBundle.localizeValue`).
5. **Lecture tolérante** : accepter encore l'ancienne forme adressée (littéral
   inline + `lang/` par adresse) pour ne pas casser un projet non re-sauvegardé
   par l'éditeur.

Vérification : `./gradlew test`. Un menu mono-langue rend son littéral ; un menu
multi rend la langue demandée puis `defaultLang` ; un `{i18n:key}` résout le
`lang/` projet ; un ancien projet inline reste rendu à l'identique. Garde :
`BundleHasher` inchangé (le hash reste sur l'arbre de fichiers).

## Phase 4 — Migration prod (déploiement)

1. Déployer le runtime tolérant (Phase 3) avant tout changement d'écriture.
2. Ouvrir le projet prod dans l'éditeur : la migration inline → map locale
   s'exécute paresseusement ; ne réécrire que les fichiers effectivement
   modifiés (aucun re-adressage global).
3. Vérifier en jeu que le rendu est identique (mono-langue), puis simuler
   l'ajout d'une langue sur un menu témoin.

Vérification : rendu identique avant/après sur le serveur prod ; aucun
`bundle_available`/hash parasite si rien n'a changé. Garde : pas de réécriture
massive des fichiers ; pas de `db:push` (aucun changement de schéma DB).

## Phase 5 — Outillage « ajouter une langue » et docs

1. Ajouter le scan « traductions manquantes » à travers tous les Documents
   (agrégation du nombre de manquants par langue) et l'import de traduction
   depuis un fichier unique (job file : arbre default + contexte).
2. Mettre à jour `docs/architecture/project-files.md`,
   `editor-internals.md` (§ i18n), l'ADR `files-first-source-of-truth` §4
   (amendement), `CONTEXT.md` (LText, Key site) et les docs-site éditeur si un
   flow visible change.

Vérification : le scan liste exactement les slots sans valeur pour la langue
cible ; l'import remplit sans inventer de clés. Garde : documenter la forme
union et la précédence dans un seul endroit de référence.
