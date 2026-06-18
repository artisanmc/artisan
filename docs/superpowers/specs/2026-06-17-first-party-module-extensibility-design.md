# Extensibilité modules first-party — design

**Date** : 2026-06-17
**Statut** : design validé (brainstorming), prêt pour plan d'implémentation **P1**
**Portée** : rendre la couture « modules » réellement **porteuse** pour que l'auteur construise ses modules métier (ex. quêtes) dans des **repos séparés** consommant des **SDK versionnés publiés**, réutilisant les composants/styles de base, et **activés par présence** du JAR sur le serveur client.

> Ce document **fait suite à** et **rend exécutable** `2026-06-15-modules-architecture-design.md`, à la lumière de (1) une clarification produit — le tiers/runtime est explicitement abandonné — et (2) un **audit du code** qui a révélé que la couture éditeur est *déclarée mais inerte*. Il **re-confirme explicitement** la décision « repos séparés » et fige un découpage en 4 phases. Quand l'implémentation démarre (P1), `modules.md` et `api-surface.md` sont mis à jour (discipline doc `CLAUDE.md`).

---

## 1. Ce qui a changé depuis le 2026-06-15

Point de départ : *« l'architecture actuelle couvre-t-elle l'ajout de modules à l'éditeur (ex. quêtes) avec leur propre UI/logique, réutilisant les composants de base, dans leur propre repo, à la WordPress/Azuriom ? »*

Trois clarifications successives ont cadré la réponse :

1. **Tiers + runtime → abandonné.** D'abord envisagé (le « vrai WordPress » : n'importe qui publie un module, chargé à chaud sans rebuild). Écarté parce que l'analogie **ne tient pas en SaaS** : WordPress/Azuriom sont auto-hébergés (le plugin tourne chez l'utilisateur, rayon de souffle = son propre site), alors qu'Artisan héberge éditeur + backend — du code tiers y tournerait sur l'infra **mutualisée** de l'auteur. On reste sur la position monopole (`2026-06-15` §2/§14).
2. **Backend des modules → complet pour le first-party.** La contrainte « backend générique » envisagée ne concernait que la *sûreté du tiers*. Le tiers retiré, les modules de l'auteur sont du **code de confiance** : ils gardent un backend complet sur le SaaS.
3. **Forme → repos séparés + SDK publié, re-confirmé explicitement.** Le brainstorming a proposé une option plus légère (« seam réel in-repo », sans packages publiés) ; l'auteur a **maintenu** le choix repos-séparés en connaissance de la taxe cross-repo.

## 2. Conséquence sur les décisions antérieures

- **`modules.md §13.9`** posait « monorepo Gradle multi-module, **PAS de repos séparés** ». Le `2026-06-15` l'avait renversé sur 3 piliers : hygiène, monétisation, *préparation au tiers*. Aujourd'hui le **tiers tombe**, et la **monétisation est portée par le seul JAR** (séparable en sous-projet/repo sans sortir le code éditeur+backend du repo plateforme — `2026-06-15` §4 : « seul le JAR plugin est distribué »). Il ne reste donc que l'**hygiène** comme justification. L'auteur **maintient néanmoins** le choix repos-séparés : décision **assumée**, pas par défaut. Ce doc l'enregistre comme telle.
- Le reste du `2026-06-15` **reste la référence** : topologie repos/artefacts (§5), frontières SDK 3 couches (§6), activation par présence (§8), versioning/discipline SDK (§9), dev-loop cross-repo (§10). Ce doc ne le remplace pas — il **comble les trous d'exécution** révélés par l'audit et fixe l'ordre de construction.

## 3. Décisions verrouillées (2026-06-17)

| Axe | Décision |
|---|---|
| **Tiers** | Hors-scope (monopole). La couture lazy-`import()` est préservée comme rampe future, **non implémentée**. |
| **Hosting** | SaaS — éditeur + backend hébergés par l'auteur ; les clients ne font tourner que des **JAR**. |
| **Distribution** | **Repos séparés** par module métier, consommant des **SDK versionnés publiés** (npm privé + Maven). |
| **Backend module** | **Complet** (first-party) : routes Hono `/api/v1/{module}` + tables Drizzle + migrations. |
| **Activation** | **Par présence** du JAR : l'éditeur ne montre que les modules installés sur le serveur courant. |
| **Module-preuve** | `artisan-quests`. |

## 4. La surface à construire (audit du code, 2026-06-17)

État **réel** constaté dans le code — au-delà de ce que le `2026-06-15` liste comme « déjà là » :

| Trou | Constat dans le code | À construire |
|---|---|---|
| **Barrel SDK = contrat seul** | `editor/src/sdk/index.ts` n'exporte que `FrontendModule` + registre + eventBus | y faire entrer les **primitives de base** ; définir une **surface publique délibérée** |
| **Seam éditeur inerte** | `FrontendModule.routes`/`.sidebar` consommés **nulle part** en prod ; `listModules()` n'est qu'un guard dans `main.tsx` ; routage 100 % file-based TanStack ; nav codée à la main | routes + nav **réellement pilotées par module** |
| **Présence non lue (éditeur)** | `server_modules` est persisté côté backend (`schema.ts`, `hub.ts`, `protocol.ts`, `editorSession.ts`), mais `main.tsx` monte **tout** inconditionnellement | endpoint de lecture + **montage conditionnel** |
| **Pas d'intégrateur** | aucun `distribution/modules.manifest.ts` ; `main.tsx` importe `menus`/`commands` **en dur** | manifeste + assemblage + lazy `import()` |
| **SDK non publiés** | `@artisan/editor-sdk` / `@artisan/backend-sdk` = **alias tsconfig** internes ; pas de packages | publish **GitHub Packages** (npm privé) + Maven (`:api`) |

> Asymétrie à noter : le **backend est déjà plus avancé** — `mountModules(app, [menusModule, commandsModule, assistantModule])` (`backend/src/app.ts:62`) monte réellement les routers Hono des modules ; le seam backend est **déjà porteur**. Le gros du travail « rendre porteur » est **côté éditeur**.

### Précisions de l'audit de code (2026-06-17)

Avant de rédiger les plans, un audit des 3 couches a affiné le tableau ci-dessus :

- **Le pipe de présence existe déjà de bout en bout.** Le plugin envoie `installed_modules` au `hello` (`WsClient.kt`), le backend `persistServerModules` (upsert + prune par `server_key`, `hub.ts`), et **l'endpoint de lecture éditeur existe et est testé** : `GET /api/v1/editor-session/:token/modules` (`editorSession.ts`). Le trou « présence » se réduit donc à : (a) l'éditeur ne **consomme** pas l'endpoint, (b) `installed_modules` est sourcé de la liste **hardcodée** `defaultModules()`, pas d'un enregistrement runtime.
- **Le seam plugin est plus profond que §4 ne le laissait croire.** Aucun moyen aujourd'hui pour un JAR séparé d'enregistrer un module : pas d'interface `ArtisanCorePlugin`, pas de `ModuleRegistry`, pas de `register()`/`isCompatibleWith()`, et `ArtisanAPI` **back-référence** la classe interne `ArtisanPlugin` (donc `api/` ne compile pas seul). C'est l'essentiel de **P1a**.
- **Conséquence : P1 est découpé en 3 sous-plans** (P1a plugin / P1b éditeur / P1c intégration cross-repo), chacun testable seul. Ordre retenu : **P1b en premier** (preuve la plus directe de l'objectif, va E2E seule grâce au pipe présence déjà en place). Plan : `docs/superpowers/plans/2026-06-17-p1b-editor-module-seam.md`.

## 5. Découpage en 4 phases

Trop gros pour un seul plan → **4 sous-projets, 1 plan d'implémentation chacun**.

**Ordre = tracer-bullet** (prouver le pipe cross-repo *mince mais bout-en-bout* avant d'investir des semaines), et non « machinery-first ». Motivation : le plus gros risque/inconnue est que la chaîne **publish → consume → assemble → présence-gate → JAR** fonctionne *du tout* sous Windows (question ouverte de `2026-06-15` §10/§13.9). On le dé-risque par construction.

### P1 — Tracer bullet cross-repo
**But** : prouver que la frontière repo-séparé fonctionne E2E **avant tout investissement de surface**.
- SDK **minimal** publié (contrat `FrontendModule` + 1-2 composants de base, ex. `Button`) sur le registry privé.
- Repo **squelette** `artisan-quests` consommant le SDK **versionné**, exposant *un* écran trivial via `@artisan/quests-editor`.
- Intégrateur + `distribution/modules.manifest.ts` **minimal** ; `main.tsx`/`app.ts` assemblent **depuis le manifeste** (fin des imports en dur).
- Présence-gating E2E : JAR quêtes squelette `depend:[Artisan]` s'annonce au `hello` → `server_modules` → l'éditeur **monte l'écran**.
- Dev-loop validé **sous Windows** : `npm link`/`file:` (JS) + Gradle **composite build** `includeBuild("../artisan-core")` (JVM).

**Critère de sortie** : sur un serveur où le JAR quêtes squelette est **présent**, ouvrir l'éditeur affiche l'écran trivial servi par `@artisan/quests-editor` ; **absent** → l'entrée est cachée. Le tout sans rebuild manuel du repo plateforme pour intégrer le module.

### P2 — Fatten le SDK éditeur
**But** : un module peut composer une UI au **look natif** sans deep-import.
- Définir la **surface publique éditeur** : design system (`components/ui/*` + tokens), `<SchemaForm>` + widgets, rendu MiniMessage, catalogue de placeholders, plomberie i18n, client API de base, types domaine partagés.
- Étendre le marquage `@Stable`/`@Internal` (aujourd'hui JVM-only) au **SDK JS** ; étendre `docs/architecture/api-surface.md` aux packages npm.
- **Dogfood** : `menus`/`commands` ne consomment **que** le barrel.

**Critère de sortie** : `artisan-quests` construit un écran non-trivial (formulaire généré + composants) en n'important **que** depuis `@artisan/editor-sdk`.

### P3 — Seam éditeur porteur + backend SDK complet
**But** : un module livre **routes + nav + backend** complets via les seuls SDK.
- **Routes** pilotées par `FrontendModule.routes` — réconcilier avec le routage file-based TanStack (deux pistes : un **catch-all par module** délégant au composant racine du module, ou des **routes code-based fusionnées par l'intégrateur** ; tranché dans le plan P3).
- **Nav/sidebar** rendue depuis `listModules()` **filtré par présence**.
- **Backend SDK** : surface publique délibérée — `BackendModule`, `mountModules`, auth (`validateAccessToken` / résolution `server_key`), accès hub WS, schema registry, et un **mécanisme d'enregistrement des migrations** du module (appliquées par l'intégrateur au boot).
- **Dogfood backend** : `assistant`/`menus`/`commands` via le barrel.

**Critère de sortie** : un module en repo séparé contribue une route, une entrée de nav présence-gatée, et des endpoints `/api/v1/{module}` + une migration, sans toucher au repo plateforme.

### P4 — Vrai module quêtes
**But** : le **dogfood** qui prouve que la frontière tient au split complet.
- `artisan-quests` étoffé en module **3 couches complètes** : éditeur bespoke (graph/timeline des chaînes de quêtes), backend (routes + tables + migrations), plugin runtime (objectives/rewards, data sources/commands).
- Activation présence E2E ; build de la **distribution** hébergée incluant quêtes ; JAR sur le pattern `depend:[Artisan]` + check `isCompatibleWith(MIN_CORE_API_VERSION)`.

**Critère de sortie** : un admin qui installe le JAR quêtes voit et édite un module quêtes complet ; le code éditeur/backend/plugin de quêtes vit **entièrement** dans `artisan-quests`, consommant uniquement les SDK versionnés.

## 6. Risques & questions ouvertes

- **Dev-loop cross-repo sous Windows** (Gradle composite + `npm link`) — **dé-risqué en P1 par construction** (c'est l'objet du tracer-bullet).
- **Réconciliation routes module ↔ TanStack file-based** — tranchée dans le plan P3 (deux pistes ci-dessus).
- **Migrations DB de modules en multi-tenant** (ordre d'application, isolation par network, rollback) — mécanisme défini en P3, exposé dans `@artisan/backend-sdk`.
- **Registry privé** : GitHub Packages (défaut, `2026-06-15` §13) vs Verdaccio self-hosted — tranché en P1.
- **Surface SDK trop large** → bumps cross-repo fréquents — mitigation : dogfooding (P2/P3) + `@Internal` agressif + revue de surface.

## 7. Hors-scope (inchangé)

- Modules **tiers** (devs externes), **federation runtime**, **licensing/billing** (différés), **self-host client** de l'éditeur/backend. La couture lazy-`import()` (P1/P3) **prépare** la federation runtime mais ne l'implémente pas.
