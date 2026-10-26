# Module distribution architecture — design

**Date**: 2026-06-15
**Status**: design validated (brainstorming), ready for the implementation plan
**Scope**: how Artisan goes from an in-repo monolith to a **platform + modules in separate repos**, distributed as SaaS, with activation by presence.

> This document **revises** `docs/architecture/modules.md` on two points (cf. §3) and **confirms** it on the rest. When implementation starts, `modules.md` is updated to integrate these decisions (CLAUDE.md doc discipline).

---

## 1. Context & goal

Artisan is today a monolith: editor (`editor/`), backend (`backend/`), plugin (`plugin/`) in a single repo, with a "modular monolith" pattern already in place (`menus`, `commands` registered at boot via registries).

Three needs push toward changing the distribution **now**, before writing the first business module:

1. **Code hygiene** (main driver) — a module's code (e.g. quests) must live in **its own repo**, with `artisan-core` as a **versioned dependency**. No quests code polluting the platform repo.
2. **Monetization** — each business module will be sold on MC marketplaces (Polymart/BuiltByBit) as a **JAR**, with Artisan Core (free) as a dependency. Modules install on MC servers the author does not control.
3. **Clean from the start** — imminent prod deployment (Core only), modules added over the following weeks. The infra must not need redoing when the modules arrive.

**Short-term out of scope** (cf. §14): third-party modules (the author wants a monopoly on their ecosystem), licensing/billing, runtime federation.

---

## 2. Locked decisions

| Axis | Decision |
|---|---|
| **Ownership** | First-party only. Third parties deferred. Monopoly assumed. |
| **UI tiers** | Schema-driven by default (`<SchemaForm>`) **+ custom React escape hatch** per module. |
| **Source layout** | **Separate repos** per business module (1 repo = the module's full stack). Driver = hygiene. |
| **Hosting** | **SaaS**: the author hosts editor + backend (multi-tenant). Customers only run JARs. |
| **Activation** | **By presence**: module installed on the MC server → appears in the editor. No license (for now). |

---

## 3. Reconciliation with `modules.md`

**Confirmed** (the design builds on it):
- **§3.3 plugin split** — Core (free, mandatory) + one JAR per business module, `depend: [Artisan]`. Vault/PAPI pattern.
- **§3.3.5 activation by presence** — the Core plugin declares the installed modules at the `hello` handshake, the editor filters its UI. This design **refines** that mechanism (cf. §8).
- **§4 composition** — data sources + commands via registries, zero direct coupling.
- **§5 bootstrap bundles** — each module ships its default content in its JAR.
- **§8 `<SchemaForm>`** — the form-from-schema multiplier.
- **§13 versioning** — strict SemVer on the public API, `@Stable`/`@Internal`, graceful failure on mismatch.

**Overturned**:
- **§13.9 "Gradle monorepo, NOT separate repos"** → this design adopts **separate repos** for business modules. The friction §13.9 feared (cross PRs, coordinated version bumps) is real and **accepted**: justified by hygiene + monetization, and **mitigated** by a local linked dev-loop (cf. §10). Consequence: the **SDK boundary** that §9 reserved for V3 (third parties) is **brought forward to now**, because the author's own module repos need it to compile.
- **§3.1 / §3.2 "in-repo modules (`editor/src/modules/{id}`)"** → true **only for core modules** (menus, commands, i18n, dialogs). **Business** modules live in separate repos and are consumed as **packages** by the integrator app.

---

## 4. Deployment model

| Side | Runs | Receives |
|---|---|---|
| **Author (artisanmc.net)** | Bun backend + web editor, **multi-tenant** | a **single distribution** built with the editor/backend packages of **all** their modules; visibility gated **by presence** per server |
| **Customer (MC server)** | Artisan Core (free JAR) + purchased modules (JARs) | **only JARs**. The module plugin `depend: [Artisan]`, syncs to the hosted backend via the existing `server_key` |

**Key property**: a module's editor/backend code **never leaves the author's control** (it is built into the hosted distribution). Only the **plugin JAR** is distributed. The "monopoly" is therefore structural, and a pirated JAR alone is unusable (no editor to create content, backend does not serve the data).

---

## 5. Repo topology & artifacts

### 5.1 Platform repo (`Artisan`, the current repo)

Stays **a single repo**. Contains the platform + the publishable SDK packages + the core modules + the integrator app.

```
Artisan/                          (= "artisan-core", the current repo)
  editor/
    src/                          ← editor app (the integrator "shell")
    src/modules/{menus,commands}/ ← CORE modules, in-repo (unchanged)
    packages/editor-sdk/          ← @artisan/editor-sdk (published, private npm)
  backend/
    src/                          ← backend app
    src/modules/{menus,commands,assistant}/  ← CORE modules, in-repo
    packages/backend-sdk/         ← @artisan/backend-sdk (published, private npm)
  plugin/
    core/                         ← Artisan.jar (Gradle :core)
    api/                          ← net.artisanmc:artisan-core-api (published Maven)
    modules/{menus,commands}/     ← CORE modules, in-repo
  distribution/
    modules.manifest.ts           ← lists the @artisan/*-{editor,backend} to include
```

**Publishes**: `net.artisanmc:artisan-core-api` (Maven), `@artisan/editor-sdk`, `@artisan/backend-sdk` (private npm — GitHub Packages at first). Plus the hosted distribution (deployed, not published).

### 5.2 Business module repo (e.g. `artisan-quests`)

One repo **per paid module**. Depends on the **versioned** SDKs.

```
artisan-quests/
  editor/    → @artisan/quests-editor   (private npm; depends on @artisan/editor-sdk)
  backend/   → @artisan/quests-backend  (private npm; depends on @artisan/backend-sdk)
  plugin/    → ArtisanQuests.jar        (Gradle; depends on artisan-core-api; depend:[Artisan])
```

**Distributes publicly**: `ArtisanQuests.jar` (the only artifact that goes to a marketplace). The `@artisan/quests-*` packages stay **private** (only the author's hosted distribution consumes them).

---

## 6. SDK boundaries — the three layers

The principle: the **existing registries** (`registerModule`, `mountModules`, `defaultModules`) are already the seam. Today they import from `./modules/…`; tomorrow the **integrator app** assembles the core modules (in-repo) **+** the business module packages (external) listed in `distribution/modules.manifest.ts`. The registry does not change — only the **source of the imports** changes.

### 6.1 Plugin (JVM) — `artisan-core-api` (Maven)

- Extract the Gradle subproject `:api` (current `net.artisanmc.modules.api.*`: `ArtisanModule`, `ArtisanAPI`, `DataSourceRegistry`, `CommandRegistry`, `SchemaRegistry`/`SchemaMigration`, `*Declaration`, `@Stable/@Beta/@Internal/@Sunset` annotations) → published Maven artifact.
- `:core` (Artisan.jar) exposes the API at runtime. A module plugin does `compileOnly("net.artisanmc:artisan-core-api:X")` and, in `onEnable()`, gets Core via `getPlugin("Artisan")` then `core.api.modules.register(questsModule)` (Bukkit `depend` + service provider pattern — already sketched in `modules.md §3.3.2`).
- The compat check (`isCompatibleWith(MIN_CORE_API_VERSION)`) + graceful disable: `modules.md §13.2-13.3`.

### 6.2 Backend (TS) — `@artisan/backend-sdk`

- Extract `backend/src/modules/api/*` (`BackendModule`, `mountModules`, types) → published package.
- Public surface to delimit: the `BackendModule` contract (Hono routes mounted under `/api/v1/{module}/…`, Drizzle tables + the module's **migrations**, WS handlers, declared data sources/commands), auth access (`validateAccessToken` / `server_key` resolution), WS hub access, schema registry.
- The **backend app** (integrator) calls `mountModules(app, [...coreModules, ...manifestModules])`. The modules' **migrations** are applied by the integrator at boot (a module's tables live in the hosted multi-tenant Postgres; data per network, gated by presence — cf. §8).

### 6.3 Editor (React) — `@artisan/editor-sdk`

- Extract `editor/src/modules/api/*` (`FrontendModule`, `registerModule`/`listModules`, `ModuleEvent`/eventBus) **+ the shared primitives** a module reuses: `<SchemaForm>` + widgets, design system (`components/ui/*` + tokens), `MiniMessageInline`/render, placeholder catalog, i18n plumbing, base API client, `RevealField`, shared domain types.
- The **editor app** (integrator shell) assembles the registry from the manifest. **Lazy import**: each business module is a `() => import("@artisan/quests-editor")`, mounted **only** when the presence signal says the module is active for the current server (cf. §8). Benefits: light initial bundle, a non-buyer does not download the module's JS, and **the same `import()` seam will become runtime federation** the day of third parties.

---

## 7. The two UI tiers

- **Schema-driven (default)**: the module declares a JSON Schema, `<SchemaForm>` generates the form (cf. `modules.md §8`). ~80% of module screens. Zero/little React.
- **Bespoke (escape hatch)**: a module can ship custom React in its editor package (e.g. a quests graph editor), exactly like the menu canvas. In SaaS the module code is built by the author → bespoke is "free" (no sandbox constraint).

---

## 8. Activation by presence (new subsystem)

The **visibility gate = the presence of the module on the MC server**. No license table.

**Flow**:
1. Module JAR at `onEnable()` → registers with Core (service provider). Core has the authoritative list of active `ArtisanModule`s in-process.
2. Core includes `installed_modules: [{id, version}]` in the `hello` handshake (`modules.md §3.3.5`) **+ a delta** via `module_event` if a module is hot-loaded afterwards (the editor eventBus already listens to `module_event`).
3. The backend **persists** the active modules **per `server_key`** (table such as `server_modules(server_key_id, module_id, version, last_seen)`), upsert on `hello`/delta.
4. The editor reads the persisted set → conditionally mounts the module's editor package (lazy import §6.3).

**Decisions**:

| Decision | Choice |
|---|---|
| Granularity | per **`server_key`**; network view = **union** of servers |
| Offline | the set **persists** while the server is off; updated at the next `hello` | 
| Uninstall | module removed → **UI hidden**, **authored data never deleted** (reinstall → everything comes back) |
| Version skew | the editor (which bundles all schema versions) chooses the rendering according to the reported `version` |
| Non-installed modules | M1: **hidden**. (The "greyed out + marketplace link" upsell option from `modules.md §3.3.5` = deferred UX, non-blocking.) |

**Not throwaway for monetization**: the day of a license system, the entitlement becomes an **additive backend check** on this same signal (presence *necessary*, entitlement *sufficient*). The presence infra is reused as is.

---

## 9. Versioning & SDK discipline

- **Strict SemVer** on the three SDKs (`artisan-core-api`, `@artisan/editor-sdk`, `@artisan/backend-sdk`). Avoid majors (cf. `modules.md §13`).
- Extend the `@Stable/@Beta/@Internal` discipline (today **JVM-only**) to the **JS SDK**: marking of public exports + `docs/architecture/api-surface.md` extended to the npm packages.
- The 4 existing disciplines (`CHANGELOG`, schema = new folder, forward-only DB, versioned REST URL — `docs/architecture/versioning.md`) apply to each module repo **and** to the platform repo.
- SDK breaking change → modules cannot compile → detected in CI (core dogfooding is the canary, cf. §11).

---

## 10. Cross-repo dev-loop (mitigation of the §13.9 friction)

Separate repos ⇒ a feature touching the Core API **+** a module = coordinated change + SDK bump. Mitigations to stay livable solo:

- **Local linked dev, publish at release only**:
  - JS: `npm link` / `file:` dep on the local checkout of `@artisan/editor-sdk` in the module repo.
  - JVM: Gradle **composite build** (`includeBuild("../artisan-core")`) → the module compiles against the local Core without publishing.
- **Publish only for CI/release** (stable versions on the private registry; no snapshot on every save).
- **Minimal and stable SDK**: the smaller the surface, the less frequent the cross-repo bumps. Core dogfooding forces keeping the SDK sufficient but not chatty.

---

## 11. What exists vs what is new

**Already there (seam in place)**:
- `editor/src/main.tsx` → `registerModule(menusModule)` / `registerModule(commandsModule)`.
- `backend/src/app.ts` → `mountModules(app, [menusModule, commandsModule, assistantModule])`.
- `plugin/.../ArtisanPlugin.kt` → `defaultModules(): List<ArtisanModule>`.
- Data source / command registries, API annotations, `module_event` eventBus, `hello` handshake, `<SchemaForm>`, versioned schemas.

**New to build (M1)**:
1. Extraction of the **3 SDK packages** (deliberate public surfaces + semver) — §6.
2. **Integrator app + `modules.manifest.ts`** — assembles core (in-repo) + modules (packages).
3. **Private npm registry** (GitHub Packages) + Maven publish.
4. **Dogfooding**: menus/commands consume the SDK exactly like an external module (proof that the boundary holds).
5. **Presence persistence** per `server_key` + editor reading — §8.
6. **`@Stable` discipline extended to JS** + `api-surface.md` updated.

---

## 12. Milestones

- **M1 — The whole architecture now** *(decided)*. The 6 "new" workstreams above. Lands **before writing a single line of business module code**, so the first module is born within a clean boundary. The Core prod deployment can happen on the current structure **in parallel** (nothing in M1 is customer-facing on the plugin side).
- **M2 — First module repo (quests) end-to-end**. `artisan-quests` repo consuming the versioned SDKs; E2E activation by presence; distribution build with quests; `depend: [Artisan]` JAR.
- **M3 — Monetization** *(deferred)*. Marketplace listings + license as an additive layer on presence.

---

## 13. Risks & open questions

- **SDK surface too wide** → frequent cross-repo bumps. Mitigation: dogfooding + surface review, keep `@Internal` aggressive.
- **Module DB migrations in multi-tenant**: application order, rollback, isolation per network. To detail in the M1 plan (migration registration mechanism in `@artisan/backend-sdk`).
- **Dev-loop**: validate that Gradle composite build + `npm link` is smooth on Windows (the dev environment) before committing to the pattern.
- **Open question**: private registry = GitHub Packages (simple, tied to the repo) vs self-hosted Verdaccio? Proposed default: GitHub Packages.
- **Open question**: non-installed modules = hidden (M1) vs greyed-upsell (`§3.3.5`) — decide at the time of the first paid module.

---

## 14. Out of scope

- **Third-party** modules (external devs) — monopoly assumed short term.
- **Licensing / billing** — deferred (M3).
- **Runtime federation** — the lazy-import seam prepares it, but we do not implement it.
- **Customer self-host** of the editor/backend — SaaS only.
