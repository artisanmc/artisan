# Schémas & types — source de vérité, types à la main, enforcement ajv

## Source de vérité

Pour chaque schéma versionné, la vérité est le fichier `docs/schema/<name>/v1/schema.json` (JSON Schema **2020-12**). Tout le reste (types Kotlin, types TS, exemples, fixtures) doit se conformer à ce fichier.

## Types écrits à la main

Les types ne sont **pas générés** — ils sont **écrits à la main** dans les deux langages, en modélisant fidèlement les unions discriminées du schéma :

- **Plugin (Kotlin)** : `sealed class` avec une sous-classe `data class` par variante (ex. `Condition`/`Action` → une sous-classe typée par `type`), désérialisation polymorphe Jackson (`@JsonTypeInfo(use = NAME, property = "type")` + `@JsonSubTypes`).
- **Éditeur (TS)** : unions discriminées (`type Condition = HasPermission | HasMoney | …`), une interface par variante, discriminant `type` littéral.

**Quicktype a été évalué et écarté (NO-GO)** : il aplatit les `oneOf` discriminés par `const` en une seule god-object `data class`/`interface` (tous champs nullables), sans sous-classes ni annotations Jackson, et crashe sur un `const` booléen. Détail et verdict complet dans `docs/schema/CODEGEN.md`. Pas de génération de code.

## Enforcement

La cohérence types ↔ schéma n'est **pas** garantie par codegen mais par validation :

- Validateur **ajv** (draft 2020-12) : `editor/src/schema/validateMenuV1.ts` + `editor/src/schema/validateMenuV1.test.ts`.
- Exemples canoniques : `docs/schema/menu/v1/examples/*.json` (au moins un par variante d'union + menus complets).
- CI : `.github/workflows/schema.yml` valide les exemples contre `schema.json` sur chaque PR (pas de step de codegen-drift — la vérité = schéma + ajv).

> **Côté éditeur (P1.1 ✅)** : l'export émet la forme canonique `menu/v1` et un oracle « golden pack → export → ajv » (`editor/src/features/export/canonical.test.ts`) prouve la conformité ; `docs/schema/menu/v1/types.ts` est aligné sur le schéma.
> **À venir (P1.2)** : côté plugin, aligner les types Kotlin et ajouter un round-trip « fixture → parse dans le type à la main » pour attraper aussi les divergences que le schéma seul ne voit pas.

## Règle de modification

Modifier un `docs/schema/*/v1/schema.json` ⇒ dans le même mouvement :

1. Aligner les types à la main (éditeur **et** plugin).
2. Garder les exemples / fixtures verts (`editor/src/schema/validateMenuV1`).
3. Ne jamais éditer un schéma `v1` déjà shippé en breaking — créer un `v2` (cf. `docs/architecture/versioning.md`).

## Gaps runtime documentés

Le schéma `menu/v1` inclut des constructs que le **plugin n'exécute pas encore** (projets séparés, à traiter ultérieurement) :

- exécution des branches `if` d'un step-tree de clic ;
- `context_inputs` / itération ;
- évaluation des `expression` ;
- actions `set_arg*`.

Le schéma les décrit (l'éditeur peut les produire/valider), mais le runtime plugin les ignore tant que les projets dédiés ne sont pas livrés.

## Statut / phasage

| Phase | Portée | Statut |
|---|---|---|
| **P1.0** | `menu/v1` : schéma canonique + validateur ajv + CI | ✅ fait |
| **P1.1** | Conformité éditeur (export `menu/v1` canonique + `types.ts` aligné sur le schéma + oracle ajv `editor/src/features/export/canonical.test.ts`) | ✅ fait |
| **P1.2** | Conformité plugin (types Kotlin alignés sur le schéma) | à faire |
| **P2** | `command` / `dialog` / `translations` / `manifest` / `template` (même traitement) | à faire |
