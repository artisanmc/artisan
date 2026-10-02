# Wire d'action structuré (YAML keyed par nom), DSL éliminé

Statut : en cours (2026-09-30). **Phases 0, 1, 2, 3, 4, 5 (partielle), 7 (partielle)** livrées :
schémas keyed tolérants (menu/command/dialog + `types.ts`) ; codec `structuredSteps.ts` ; **l'éditeur
écrit et lit le wire keyed** (texte d'action field-local, `lang/` réduit aux clés sans site + data
sources) ; runtime plugin keyed (`KeyedStepParser` + `ActionChainCompiler`, `LocalizedText`) ;
**assistant** : guides (`menu`/`command`/`dialog`), prompt VOCAB et validation de migration
(collecte des liens `open_menu` keyed) passés au keyed ; doc `action-steps.md` verrouillée. Suites
éditeur (372) et plugin (1114+) vertes ; **backend non testé ici** (Postgres local absent).

**Correction d'une prémisse du plan :** l'éditeur de steps visuel **existe déjà**
(`ControlledStepsEditor` + primitives `PseudocodeView` éditent le domaine `Step[]` directement ;
seul le *wire* était du DSL). Rien à construire de ce côté.

**Data-source `actions` migrés au structuré** (`literalSteps` ⇄ codec `structuredSteps`, éditeur
data-source simplifié, plugin `run_actions` keyed via `ActionChainCompiler`, schéma data/v1). Donc
le **wire est structuré partout** ; le **DSL ne sert plus que de lecteur legacy** (vieux fichiers
DSL + gates backend `parseActionDsl`).

Suites vérifiées : **éditeur (3025 vertes)**, **plugin (vertes)**, **backend (1292 vertes)**.

**Appearance/state `if` passe en keyed** (export via `conditionsToStructured`, plugin via
`KeyedStepParser.parseConditions`, gate backend unifié) — un seul format de condition partout.

**Code mort retiré** : `serializeStepsLiteral`/`serializeAction`/`serializeStep` (transform),
`stepsToDsl`/`dslToSteps` project-aware (`domainSteps` + barrel). Le codec DSL survit **uniquement
comme lecteur legacy** (vieux fichiers + gates backend).

## Migration prod (point 3) — runbook

Ordre imposé (sinon perte des actions des fichiers non migrés) :

1. **Déployer le plugin** (celui de ce commit) — il lit **keyed ET legacy** (string DSL,
   `{steps}`, `type:`-tagged). Le rendu en jeu ne change pas.
2. **Ouvrir chaque projet dans l'éditeur** (ou un save global) et **enregistrer** : l'import lit
   l'ancien DSL, l'export ré-écrit **keyed**. Vérifier en jeu (rendu identique).
3. **Confirmer** qu'aucun fichier ne porte plus de string DSL : `grep` sur `projects/*/menus`,
   `commands`, `dialogs`, `data` (patterns `steps: "`, `actions: "` ou une string contenant
   `send_message`/`@`).
4. **Alors seulement**, retirer le lecteur legacy (point 2) :

## Retrait du DSL (point 2) — après l'étape 3

- Éditeur : `actionV1ToDomain.dslToSteps` (branche string), `literalSteps.stepsFromWire` (branche
  string), puis tout `actionDsl/*` (lexer/parser/printer/ast/domainSteps) + tests + barrel.
- Plugin : branche string de `ActionChainCompiler`, `ActionParser`/`StepParser`/`ConditionParser`
  type-tagged, `assignI18nAddresses` (adresses inline), `compileActionDsl`.
- Backend : `parseActionDsl` dans `validate.ts` (gate DSL) et `migration/validation.ts`, plus
  `action-dsl-fixtures`.
- Contrôle : `menu/v1` schema `ConditionLegacy`/branches legacy peuvent aussi tomber.

**Bloqué tant que l'étape 3 n'est pas faite** — retirer maintenant casserait l'ouverture des
projets non migrés.

**Ordre de bascule sûr** : le plugin doit savoir LIRE le keyed (P4) avant que l'éditeur ne l'ÉCRIVE (P2/P3), sinon un serveur prod en retard casse.
ADR de référence : `docs/decisions/structured-action-wire.md`.

## Objectif

Remplacer la string DSL comme **unique représentation** des chaînes d'actions
(menus/commands/dialogs/data sources) par un YAML **structuré keyed par nom**,
dont les textes sont des `LocalizedText`. Le codec DSL est **supprimé** à terme ;
la lecture du DSL reste **tolérante** le temps de la migration prod.

## Phase 0 — Schéma (tests d'abord)

1. Réécrire les defs `Step`/`Action`/`Condition` de `docs/schema/menu/v1`,
   `command/v1`, `dialog/v1` en forme **keyed** (`{ <nom>: args }`), texte =
   `$ref LText`. `if:` = liste (AND) ; `or:`/`and:` = liste ; `not:` = condition ;
   `do:`/`else:` ; `else if` récursif. Retirer `type`/`kind`/`joins`/`cases`.
2. Ajouter les fixtures/exemples validants (action simple, sans arg, multi-args,
   if composite imbriqué, texte map).
3. Aligner `docs/schema/menu/v1/types.ts` (+ command) sur la forme keyed.

Vérification : `validateMenuV1.test` couvre keyed simple/if/text-map ; exemples
canoniques verts. Garde : `LText` réutilisé, pas de nouvelle syntaxe texte.

## Phase 1 — Mapping structuré ⇄ domaine (tests d'abord)

1. `stepsToStructured(steps): unknown` et `structuredToSteps(raw, bridge)`
   (inverse) dans `editor/src/domain/` ou `lib/actions/`. Tests de round-trip sur
   tous les `Action`/`Condition` (20+18), keyed, text `LocalizedText`.
2. Lecture tolérante : string DSL (via le codec existant, temporaire), map
   single-step, liste avec string nue, `close_menu:` nul. Normalisation
   `- close_menu` ⇄ `- close_menu:`.
3. Tests de discrimination par type.

Vérification : `structuredToSteps ∘ stepsToStructured` = identité (canonicalisée) ;
un vieux DSL parse et se ré-écrit structuré. Garde : le codec DSL reste intact
jusqu'à la Phase 6.

## Phase 2 — Éditeur de steps structuré (UI)

1. Remplacer `ControlledStepsEditor` (zone texte DSL) par un éditeur visuel :
   arbre de steps, ajout action/condition, sélection du type, champs par type
   (design system `components/ui/`).
2. Les champs texte des actions utilisent l'éditeur `LocalizedText` existant.

Vérification : `ControlledStepsEditor`/`literalSteps` tests remplacés par des
tests du nouvel éditeur. Garde : design system, pas de styling ad-hoc.

## Phase 3 — Export éditeur (tests d'abord)

1. `features/export/transform.ts` : `serializeAppearance` (click),
   `serializeCommand`, `serializeDialogButton` émettent le **structuré**.
2. `collectReferencedKeys`/`serializeLang` : les textes d'action ne sont plus des
   clés → `lang/` se réduit aux clés sans site + data sources.
3. `emitDataSources` : les champs `actions` basculent sur le structuré (même
   wire).

Vérification : `transform.test.ts`, `transformInline.test.ts`, `canonical.test.ts`,
`menuV1.test.ts`, `dialogV1.schema.test.ts`, `dataV1.test.ts`. Garde : point fixe.

## Phase 4 — Import éditeur (tests d'abord)

1. `menuV1ToDomain` / `commandV1ToDomain` / `dialogV1ToDomain` / `actionV1ToDomain` :
   lire le structuré, tolérer le legacy DSL (temporaire).
2. `makeAppearanceConverter.clickMap` : string = DSL, map/liste = structuré.

Vérification : `projectFromFiles.test.ts`, `projectImportRoundTrip.test.ts`,
`menuV1ToDomain.roundtrip.test.ts`. Garde : vieux fichier importé → ré-exporté
structuré sans perte.

## Phase 5 — Runtime plugin (tests d'abord)

1. Étendre les tests (`BundleCompilerTest`, `ActionExecutor`, `ElementDisplayStatesTest`,
   `FieldLocalTextTest`).
2. Modèles YAML : `ClickHandlerYaml.steps`, `DialogButtonYaml.actions`,
   `ActionChain` acceptent `String | List<Any?>` ; parseurs keyed
   `Action`/`Condition`/`Step` (remplacer `ActionParser`/`ConditionParser`/
   `StepParser`).
3. Texte d'action → `LocalizedText` ; `resolveText` résout la map. Retirer les
   champs `i18n*` et `assignI18nAddresses`.
4. Tolérance : handler string → `compileActionDsl` (legacy) ; sinon structuré.

Vérification : `./gradlew test`. Ancien menu DSL rend identique ; menu structuré
rend pareil ; texte map localisé. Garde : `BundleHasher` inchangé.

## Phase 6 — Suppression du DSL + migration prod

1. Déployer le runtime tolérant (Phase 5) d'abord ; ouvrir le projet prod →
   ré-écriture structurée au premier save ; rendu identique (mono-langue).
2. Une fois plus aucun projet en DSL : supprimer le codec `actiondsl` (TS +
   Kotlin), `DslToEngine`, fixtures `action-dsl-fixtures.json`, `ControlledStepsEditor`
   DSL, et la lecture tolérante.
3. Assistant : `write_menu`/tools + guide de grounding en structuré ;
   `validate.ts` valide le keyed.

Vérification : une génération assistant passe `validateMenuV1` ; plus aucune
référence au DSL. Garde : pas de `db:push`.

## Phase 7 — Documentation avec exemples (au fil de l'eau)

Écrire le **fonctionnement** du wire structuré, avec des exemples complets et
copiables, dans une doc dédiée + les docs existants :

1. `docs/architecture/action-steps.md` (nouveau) : référence du format keyed —
   action à 1 arg / 0 arg / multi-args, `if:`/`or`/`and`/`not`, `do`/`else`,
   `else if` récursif, texte `LocalizedText`, lecture tolérante du DSL legacy.
   Chaque construct avec un **exemple YAML** (simple puis composite imbriqué).
2. `editor-internals.md` (§ action steps) : pointer la doc de référence + décrire
   l'éditeur visuel.
3. `CONTEXT.md` (Action chain) et `docs/schema/*/README.md` : forme keyed.
4. Amendement `action-dsl.md` (décision 1 + Phase 2 + portabilité superseded).
5. `docs-site/` : si un flow user-facing change (éditeur de steps), page dédiée.

Vérification : chaque exemple de la doc est **validé** par `validateMenuV1` (test
« doc examples ») — la doc ne dérive pas du schéma. Garde : un seul doc de
référence du format, les autres pointent vers lui.
