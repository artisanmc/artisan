# Architecture de distribution des modules — design

**Date** : 2026-06-15
**Statut** : design validé (brainstorming), prêt pour plan d'implémentation
**Portée** : comment Artisan passe d'un monolithe in-repo à une **plateforme + modules en repos séparés**, distribuée en SaaS, avec activation par présence.

> Ce document **révise** `docs/architecture/modules.md` sur deux points (cf. §3) et le **confirme** sur le reste. Quand l'implémentation démarre, `modules.md` est mis à jour pour intégrer ces décisions (discipline doc CLAUDE.md).

---

## 1. Contexte & objectif

Artisan est aujourd'hui un monolithe : éditeur (`editor/`), backend (`backend/`), plugin (`plugin/`) dans un seul repo, avec un pattern « modular monolith » déjà en place (`menus`, `commands` enregistrés au boot via des registres).

Trois besoins poussent à faire évoluer la distribution **maintenant**, avant d'écrire le premier module métier :

1. **Hygiène de code** (driver principal) — le code d'un module (ex. quêtes) doit vivre dans **son propre repo**, avec `artisan-core` comme **dépendance versionnée**. Pas de code quêtes qui pollue le repo de la plateforme.
2. **Monétisation** — chaque module métier sera vendu sur des marketplaces MC (Polymart/BuiltByBit) sous forme de **JAR**, avec Artisan Core (gratuit) en dépendance. Les modules s'installent sur des serveurs MC que l'auteur ne contrôle pas.
3. **Propre dès le début** — déploiement prod imminent (Core seul), modules ajoutés sur les semaines suivantes. L'infra ne doit pas être à refaire quand les modules arrivent.

**Hors-scope court terme** (cf. §14) : modules tiers (l'auteur veut le monopole sur son écosystème), licensing/billing, federation runtime.

---

## 2. Décisions verrouillées

| Axe | Décision |
|---|---|
| **Ownership** | First-party only. Tiers différés. Monopole assumé. |
| **Tiers d'UI** | Schéma-driven par défaut (`<SchemaForm>`) **+ échappatoire React custom** par module. |
| **Layout source** | **Repos séparés** par module métier (1 repo = full stack du module). Driver = hygiène. |
| **Hosting** | **SaaS** : l'auteur héberge éditeur + backend (multi-tenant). Les clients ne font tourner que des JARs. |
| **Activation** | **Par présence** : module installé sur le serveur MC → apparaît dans l'éditeur. Pas de licence (pour l'instant). |

---

## 3. Réconciliation avec `modules.md`

**Confirmé** (le design s'appuie dessus) :
- **§3.3 split plugins** — Core (free, obligatoire) + un JAR par module métier, `depend: [Artisan]`. Pattern Vault/PAPI.
- **§3.3.5 activation par présence** — le plugin Core déclare les modules installés au handshake `hello`, l'éditeur filtre son UI. Ce design **raffine** ce mécanisme (cf. §8).
- **§4 composition** — data sources + commands via registries, zéro couplage direct.
- **§5 bootstrap bundles** — chaque module ship son contenu par défaut dans son JAR.
- **§8 `<SchemaForm>`** — le multiplicateur form-from-schema.
- **§13 versioning** — SemVer strict sur l'API publique, `@Stable`/`@Internal`, graceful failure sur mismatch.

**Renversé** :
- **§13.9 « monorepo Gradle, PAS de repos séparés »** → ce design adopte **les repos séparés** pour les modules métier. La friction que §13.9 redoutait (PR croisées, version bumps coordonnés) est réelle et **assumée** : justifiée par l'hygiène + la monétisation, et **mitigée** par un dev-loop linké local (cf. §10). Conséquence : la **frontière SDK** que §9 réservait à la V3 (tiers) est **avancée à maintenant**, parce que les propres repos modules de l'auteur en ont besoin pour compiler.
- **§3.1 / §3.2 « modules in-repo (`editor/src/modules/{id}`) »** → vrai **uniquement pour les modules core** (menus, commands, i18n, dialogs). Les modules **métier** vivent dans des repos séparés et sont consommés comme **packages** par l'app intégrateur.

---

## 4. Modèle de déploiement

| Côté | Fait tourner | Reçoit |
|---|---|---|
| **Auteur (artisanmc.net)** | backend Bun + éditeur web, **multi-tenant** | une **distribution unique** buildée avec les packages éditeur/backend de **tous** ses modules ; visibilité gatée **par présence** par serveur |
| **Client (serveur MC)** | Artisan Core (JAR free) + modules achetés (JARs) | **uniquement des JARs**. Le plugin module `depend: [Artisan]`, se sync au backend hébergé via le `server_key` existant |

**Propriété clé** : le code éditeur/backend d'un module **ne quitte jamais le contrôle de l'auteur** (il est buildé dans la distrib hébergée). Seul le **JAR plugin** est distribué. Le « monopole » est donc structurel, et un JAR piraté seul est inexploitable (pas d'éditeur pour créer du contenu, backend ne sert pas la donnée).

---

## 5. Topologie repos & artefacts

### 5.1 Repo plateforme (`Artisan`, le repo actuel)

Reste **un seul repo**. Contient la plateforme + les packages SDK publiables + les modules core + l'app intégrateur.

```
Artisan/                          (= "artisan-core", le repo actuel)
  editor/
    src/                          ← app éditeur (le "shell" intégrateur)
    src/modules/{menus,commands}/ ← modules CORE, in-repo (inchangé)
    packages/editor-sdk/          ← @artisan/editor-sdk (publié, npm privé)
  backend/
    src/                          ← app backend
    src/modules/{menus,commands,assistant}/  ← modules CORE, in-repo
    packages/backend-sdk/         ← @artisan/backend-sdk (publié, npm privé)
  plugin/
    core/                         ← Artisan.jar (Gradle :core)
    api/                          ← net.artisanmc:artisan-core-api (publié Maven)
    modules/{menus,commands}/     ← modules CORE, in-repo
  distribution/
    modules.manifest.ts           ← liste les @artisan/*-{editor,backend} à inclure
```

**Publie** : `net.artisanmc:artisan-core-api` (Maven), `@artisan/editor-sdk`, `@artisan/backend-sdk` (npm privé — GitHub Packages au début). Plus la distribution hébergée (déployée, non publiée).

### 5.2 Repo module métier (ex. `artisan-quests`)

Un repo **par module payant**. Dépend des SDK **versionnés**.

```
artisan-quests/
  editor/    → @artisan/quests-editor   (npm privé ; dépend de @artisan/editor-sdk)
  backend/   → @artisan/quests-backend  (npm privé ; dépend de @artisan/backend-sdk)
  plugin/    → ArtisanQuests.jar        (Gradle ; dépend de artisan-core-api ; depend:[Artisan])
```

**Distribue publiquement** : `ArtisanQuests.jar` (le seul artefact qui part sur marketplace). Les packages `@artisan/quests-*` restent **privés** (seule la distrib hébergée de l'auteur les consomme).

---

## 6. Frontières SDK — les trois couches

Le principe : les **registres existants** (`registerModule`, `mountModules`, `defaultModules`) sont déjà la couture. Aujourd'hui ils importent depuis `./modules/…` ; demain l'**app intégrateur** assemble les modules core (in-repo) **+** les packages modules métier (externes) listés dans `distribution/modules.manifest.ts`. Le registre ne change pas — seule la **source des imports** change.

### 6.1 Plugin (JVM) — `artisan-core-api` (Maven)

- Extraire le sous-projet Gradle `:api` (`net.artisanmc.modules.api.*` actuel : `ArtisanModule`, `ArtisanAPI`, `DataSourceRegistry`, `CommandRegistry`, `SchemaRegistry`/`SchemaMigration`, `*Declaration`, annotations `@Stable/@Beta/@Internal/@Sunset`) → artefact Maven publié.
- Le `:core` (Artisan.jar) expose l'API à l'exécution. Un plugin module fait `compileOnly("net.artisanmc:artisan-core-api:X")` et, au `onEnable()`, récupère Core via `getPlugin("Artisan")` puis `core.api.modules.register(questsModule)` (pattern Bukkit `depend` + service provider — déjà esquissé `modules.md §3.3.2`).
- Le check de compat (`isCompatibleWith(MIN_CORE_API_VERSION)`) + graceful disable : `modules.md §13.2-13.3`.

### 6.2 Backend (TS) — `@artisan/backend-sdk`

- Extraire `backend/src/modules/api/*` (`BackendModule`, `mountModules`, types) → package publié.
- Surface publique à délimiter : contrat `BackendModule` (routes Hono montées sous `/api/v1/{module}/…`, tables Drizzle + **migrations** du module, WS handlers, data sources/commands déclarés), accès auth (`validateAccessToken` / résolution `server_key`), accès hub WS, schema registry.
- L'**app backend** (intégrateur) appelle `mountModules(app, [...coreModules, ...manifestModules])`. Les **migrations** des modules sont appliquées par l'intégrateur au boot (les tables d'un module vivent dans le Postgres multi-tenant hébergé ; data par network, gatée par présence — cf. §8).

### 6.3 Éditeur (React) — `@artisan/editor-sdk`

- Extraire `editor/src/modules/api/*` (`FrontendModule`, `registerModule`/`listModules`, `ModuleEvent`/eventBus) **+ les primitives partagées** qu'un module réutilise : `<SchemaForm>` + widgets, design-system (`components/ui/*` + tokens), `MiniMessageInline`/render, placeholder catalog, plomberie i18n, client API de base, `RevealField`, types domaine partagés.
- L'**app éditeur** (shell intégrateur) assemble le registre depuis le manifeste. **Lazy import** : chaque module métier est un `() => import("@artisan/quests-editor")`, monté **seulement** quand le signal de présence dit le module actif pour le serveur courant (cf. §8). Bénéfices : bundle initial léger, un non-acheteur ne télécharge pas le JS du module, et **la même couture `import()` deviendra de la federation runtime** le jour des tiers.

---

## 7. Les deux tiers d'UI

- **Schéma-driven (défaut)** : le module déclare un JSON Schema, `<SchemaForm>` génère le formulaire (cf. `modules.md §8`). ~80 % des écrans modules. Zéro/peu de React.
- **Bespoke (échappatoire)** : un module peut shipper du React custom dans son package éditeur (ex. graph editor de quêtes), exactement comme le canvas de menus. En SaaS le code module est buildé par l'auteur → bespoke est « gratuit » (pas de contrainte de sandbox).

---

## 8. Activation par présence (sous-système neuf)

Le **gate de visibilité = la présence du module sur le serveur MC**. Pas de table de licence.

**Flux** :
1. JAR module au `onEnable()` → s'enregistre auprès de Core (service provider). Core a la liste autoritaire des `ArtisanModule` actifs in-process.
2. Core inclut `installed_modules: [{id, version}]` dans le handshake `hello` (`modules.md §3.3.5`) **+ un delta** via `module_event` si un module est hot-loadé après coup (l'eventBus éditeur écoute déjà `module_event`).
3. Le backend **persiste** les modules actifs **par `server_key`** (table type `server_modules(server_key_id, module_id, version, last_seen)`), upsert au `hello`/delta.
4. L'éditeur lit le set persisté → monte conditionnellement le package éditeur du module (lazy import §6.3).

**Décisions** :

| Décision | Choix |
|---|---|
| Granularité | par **`server_key`** ; vue network = **union** des serveurs |
| Hors-ligne | le set **persiste** serveur éteint ; mis à jour au re-`hello` | 
| Désinstallation | module retiré → **UI cachée**, **donnée authored jamais supprimée** (réinstall → tout revient) |
| Skew de version | l'éditeur (qui bundle toutes les versions de schema) choisit le rendu selon la `version` rapportée |
| Modules non installés | M1 : **cachés**. (Option upsell « grisé + lien marketplace » de `modules.md §3.3.5` = UX différée, non bloquante.) |

**Non-jetable pour la monétisation** : le jour d'un système de licence, l'entitlement devient un **check backend additif** sur ce même signal (présence *nécessaire*, entitlement *suffisant*). L'infra présence est réutilisée telle quelle.

---

## 9. Versioning & discipline SDK

- **SemVer strict** sur les trois SDK (`artisan-core-api`, `@artisan/editor-sdk`, `@artisan/backend-sdk`). Éviter les majors (cf. `modules.md §13`).
- Étendre la discipline `@Stable/@Beta/@Internal` (aujourd'hui **JVM-only**) au **SDK JS** : marquage des exports publics + `docs/architecture/api-surface.md` étendu aux packages npm.
- Les 4 disciplines existantes (`CHANGELOG`, schema = nouveau dossier, DB forward-only, REST URL versionné — `docs/architecture/versioning.md`) s'appliquent à chaque repo module **et** au repo plateforme.
- Breaking change SDK → impossible de compiler les modules → détecté en CI (le dogfooding core est le canari, cf. §11).

---

## 10. Dev-loop cross-repo (mitigation de la friction §13.9)

Repos séparés ⇒ une feature touchant Core API **+** un module = changement coordonné + bump SDK. Mitigations pour rester vivable en solo :

- **Dev local linké, publish au release seulement** :
  - JS : `npm link` / `file:` dep du checkout local `@artisan/editor-sdk` dans le repo module.
  - JVM : Gradle **composite build** (`includeBuild("../artisan-core")`) → le module compile contre le Core local sans publier.
- **Publish uniquement pour CI/release** (versions stables sur le registry privé ; pas de snapshot à chaque sauvegarde).
- **SDK minimal et stable** : plus la surface est petite, moins les bumps cross-repo sont fréquents. Le dogfooding core force à garder le SDK suffisant mais pas bavard.

---

## 11. Ce qui existe vs ce qui est neuf

**Déjà là (couture en place)** :
- `editor/src/main.tsx` → `registerModule(menusModule)` / `registerModule(commandsModule)`.
- `backend/src/app.ts` → `mountModules(app, [menusModule, commandsModule, assistantModule])`.
- `plugin/.../ArtisanPlugin.kt` → `defaultModules(): List<ArtisanModule>`.
- Registres data source / command, annotations API, `module_event` eventBus, `hello` handshake, `<SchemaForm>`, schemas versionnés.

**Neuf à construire (M1)** :
1. Extraction des **3 packages SDK** (surfaces publiques délibérées + semver) — §6.
2. **App intégrateur + `modules.manifest.ts`** — assemble core (in-repo) + modules (packages).
3. **Registry npm privé** (GitHub Packages) + publish Maven.
4. **Dogfooding** : menus/commands consomment le SDK exactement comme un module externe (preuve que la frontière tient).
5. **Persistance présence** par `server_key` + lecture éditeur — §8.
6. **Discipline `@Stable` étendue au JS** + `api-surface.md` mis à jour.

---

## 12. Jalons

- **M1 — Toute l'archi maintenant** *(décidé)*. Les 6 chantiers « neuf » ci-dessus. Atterrit **avant d'écrire une ligne de code module métier**, pour que le premier module naisse dans une frontière propre. Le déploiement prod de Core peut se faire sur la structure actuelle **en parallèle** (rien de M1 n'est customer-facing côté plugin).
- **M2 — Premier repo module (quêtes) bout-en-bout**. Repo `artisan-quests` consommant les SDK versionnés ; activation par présence E2E ; build de la distrib avec quêtes ; JAR `depend: [Artisan]`.
- **M3 — Monétisation** *(différé)*. Listings marketplace + licence en couche additive sur la présence.

---

## 13. Risques & questions ouvertes

- **Surface SDK trop large** → bumps cross-repo fréquents. Mitigation : dogfooding + revue de surface, garder `@Internal` agressif.
- **Migrations DB des modules en multi-tenant** : ordre d'application, rollback, isolation par network. À détailler dans le plan M1 (mécanisme d'enregistrement des migrations dans `@artisan/backend-sdk`).
- **Dev-loop** : valider que composite build Gradle + `npm link` est fluide sur Windows (l'environnement de dev) avant de committer au pattern.
- **Question ouverte** : registry privé = GitHub Packages (simple, lié au repo) vs Verdaccio self-hosted ? Défaut proposé : GitHub Packages.
- **Question ouverte** : modules non installés = cachés (M1) vs grisés-upsell (`§3.3.5`) — trancher au moment du premier module payant.

---

## 14. Hors-scope

- Modules **tiers** (devs externes) — monopole assumé court terme.
- **Licensing / billing** — différé (M3).
- **Federation runtime** — la couture lazy-import la prépare, mais on ne l'implémente pas.
- **Self-host client** de l'éditeur/backend — SaaS only.
