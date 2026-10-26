# First-party module extensibility — design

**Date**: 2026-06-17
**Status**: design validated (brainstorming), ready for the **P1** implementation plan
**Scope**: make the "modules" seam actually **load-bearing** so the author can build their business modules (e.g. quests) in **separate repos** consuming **published versioned SDKs**, reusing the base components/styles, and **activated by presence** of the JAR on the customer server.

> This document **follows** and **makes executable** `2026-06-15-modules-architecture-design.md`, in light of (1) a product clarification — third-party/runtime is explicitly dropped — and (2) a **code audit** that revealed the editor seam is *declared but inert*. It **explicitly re-confirms** the "separate repos" decision and fixes a split into 4 phases. When implementation starts (P1), `modules.md` and `api-surface.md` are updated (`CLAUDE.md` doc discipline).

---

## 1. What changed since 2026-06-15

Starting point: *"does the current architecture cover adding modules to the editor (e.g. quests) with their own UI/logic, reusing the base components, in their own repo, WordPress/Azuriom-style?"*

Three successive clarifications framed the answer:

1. **Third parties + runtime → dropped.** First considered (the "real WordPress": anyone publishes a module, hot-loaded without rebuild). Ruled out because the analogy **does not hold in SaaS**: WordPress/Azuriom are self-hosted (the plugin runs at the user's, blast radius = their own site), whereas Artisan hosts editor + backend — third-party code would run there on the author's **shared** infra. We stay on the monopoly position (`2026-06-15` §2/§14).
2. **Module backend → full for first-party.** The "generic backend" constraint that was considered only concerned *third-party safety*. With third parties removed, the author's modules are **trusted code**: they keep a full backend on the SaaS.
3. **Shape → separate repos + published SDK, explicitly re-confirmed.** The brainstorming proposed a lighter option ("real in-repo seam", without published packages); the author **kept** the separate-repos choice knowing the cross-repo tax.

## 2. Consequence on earlier decisions

- **`modules.md §13.9`** stated "multi-module Gradle monorepo, **NOT separate repos**". `2026-06-15` had overturned it on 3 pillars: hygiene, monetization, *third-party preparation*. Today **third parties drop**, and **monetization is carried by the JAR alone** (separable into a subproject/repo without taking the editor+backend code out of the platform repo — `2026-06-15` §4: "only the plugin JAR is distributed"). Only **hygiene** is left as a justification. The author **nonetheless keeps** the separate-repos choice: a decision **owned**, not a default. This doc records it as such.
- The rest of `2026-06-15` **remains the reference**: repos/artifacts topology (§5), 3-layer SDK boundaries (§6), activation by presence (§8), SDK versioning/discipline (§9), cross-repo dev-loop (§10). This doc does not replace it — it **fills the execution gaps** revealed by the audit and fixes the build order.

## 3. Locked decisions (2026-06-17)

| Axis | Decision |
|---|---|
| **Third parties** | Out of scope (monopoly). The lazy-`import()` seam is preserved as a future ramp, **not implemented**. |
| **Hosting** | SaaS — editor + backend hosted by the author; customers only run **JARs**. |
| **Distribution** | **Separate repos** per business module, consuming **published versioned SDKs** (private npm + Maven). |
| **Module backend** | **Full** (first-party): Hono routes `/api/v1/{module}` + Drizzle tables + migrations. |
| **Activation** | **By presence** of the JAR: the editor only shows the modules installed on the current server. |
| **Proof module** | `artisan-quests`. |

## 4. The surface to build (code audit, 2026-06-17)

**Real** state found in the code — beyond what `2026-06-15` lists as "already there":

| Gap | Finding in the code | To build |
|---|---|---|
| **SDK barrel = contract only** | `editor/src/sdk/index.ts` only exports `FrontendModule` + registry + eventBus | bring the **base primitives** in; define a **deliberate public surface** |
| **Inert editor seam** | `FrontendModule.routes`/`.sidebar` consumed **nowhere** in prod; `listModules()` is only a guard in `main.tsx`; 100% file-based TanStack routing; hand-coded nav | routes + nav **actually module-driven** |
| **Presence not read (editor)** | `server_modules` is persisted on the backend side (`schema.ts`, `hub.ts`, `protocol.ts`, `editorSession.ts`), but `main.tsx` mounts **everything** unconditionally | read endpoint + **conditional mounting** |
| **No integrator** | no `distribution/modules.manifest.ts`; `main.tsx` imports `menus`/`commands` **hard-coded** | manifest + assembly + lazy `import()` |
| **SDKs not published** | `@artisan/editor-sdk` / `@artisan/backend-sdk` = internal **tsconfig aliases**; no packages | publish to **GitHub Packages** (private npm) + Maven (`:api`) |

> Asymmetry to note: the **backend is already more advanced** — `mountModules(app, [menusModule, commandsModule, assistantModule])` (`backend/src/app.ts:62`) actually mounts the modules' Hono routers; the backend seam is **already load-bearing**. Most of the "make it load-bearing" work is **on the editor side**.

### Code audit clarifications (2026-06-17)

Before drafting the plans, an audit of the 3 layers refined the table above:

- **The presence pipe already exists end to end.** The plugin sends `installed_modules` at `hello` (`WsClient.kt`), the backend `persistServerModules` (upsert + prune per `server_key`, `hub.ts`), and **the editor read endpoint exists and is tested**: `GET /api/v1/editor-session/:token/modules` (`editorSession.ts`). The "presence" gap therefore reduces to: (a) the editor does not **consume** the endpoint, (b) `installed_modules` is sourced from the **hardcoded** `defaultModules()` list, not from a runtime registration.
- **The plugin seam is deeper than §4 made it seem.** No way today for a separate JAR to register a module: no `ArtisanCorePlugin` interface, no `ModuleRegistry`, no `register()`/`isCompatibleWith()`, and `ArtisanAPI` **back-references** the internal `ArtisanPlugin` class (so `api/` does not compile on its own). This is the bulk of **P1a**.
- **Consequence: P1 is split into 3 sub-plans** (P1a plugin / P1b editor / P1c cross-repo integration), each testable on its own. Chosen order: **P1b first** (most direct proof of the goal, goes E2E alone thanks to the presence pipe already in place). Plan: `docs/superpowers/plans/2026-06-17-p1b-editor-module-seam.md`.

## 5. Split into 4 phases

Too big for a single plan → **4 sub-projects, 1 implementation plan each**.

**Order = tracer-bullet** (prove the *thin but end-to-end* cross-repo pipe before investing weeks), and not "machinery-first". Motivation: the biggest risk/unknown is whether the **publish → consume → assemble → presence-gate → JAR** chain works *at all* under Windows (open question of `2026-06-15` §10/§13.9). We de-risk it by construction.

### P1 — Cross-repo tracer bullet
**Goal**: prove that the separate-repo boundary works E2E **before any surface investment**.
- **Minimal** published SDK (`FrontendModule` contract + 1-2 base components, e.g. `Button`) on the private registry.
- **Skeleton** `artisan-quests` repo consuming the **versioned** SDK, exposing *one* trivial screen via `@artisan/quests-editor`.
- **Minimal** integrator + `distribution/modules.manifest.ts`; `main.tsx`/`app.ts` assemble **from the manifest** (end of hard-coded imports).
- E2E presence-gating: skeleton quests JAR `depend:[Artisan]` announces itself at `hello` → `server_modules` → the editor **mounts the screen**.
- Dev-loop validated **under Windows**: `npm link`/`file:` (JS) + Gradle **composite build** `includeBuild("../artisan-core")` (JVM).

**Exit criterion**: on a server where the skeleton quests JAR is **present**, opening the editor shows the trivial screen served by `@artisan/quests-editor`; **absent** → the entry is hidden. All without a manual rebuild of the platform repo to integrate the module.

### P2 — Fatten the editor SDK
**Goal**: a module can compose a **native-looking** UI without deep-imports.
- Define the **editor public surface**: design system (`components/ui/*` + tokens), `<SchemaForm>` + widgets, MiniMessage rendering, placeholder catalog, i18n plumbing, base API client, shared domain types.
- Extend the `@Stable`/`@Internal` marking (today JVM-only) to the **JS SDK**; extend `docs/architecture/api-surface.md` to the npm packages.
- **Dogfood**: `menus`/`commands` consume **only** the barrel.

**Exit criterion**: `artisan-quests` builds a non-trivial screen (generated form + components) importing **only** from `@artisan/editor-sdk`.

### P3 — Load-bearing editor seam + full backend SDK
**Goal**: a module delivers full **routes + nav + backend** via the SDKs alone.
- **Routes** driven by `FrontendModule.routes` — reconcile with TanStack file-based routing (two tracks: a **per-module catch-all** delegating to the module's root component, or **code-based routes merged by the integrator**; decided in the P3 plan).
- **Nav/sidebar** rendered from `listModules()` **filtered by presence**.
- **Backend SDK**: deliberate public surface — `BackendModule`, `mountModules`, auth (`validateAccessToken` / `server_key` resolution), WS hub access, schema registry, and a **migration registration mechanism** for the module (applied by the integrator at boot).
- **Backend dogfood**: `assistant`/`menus`/`commands` via the barrel.

**Exit criterion**: a module in a separate repo contributes a route, a presence-gated nav entry, and `/api/v1/{module}` endpoints + a migration, without touching the platform repo.

### P4 — Real quests module
**Goal**: the **dogfood** that proves the boundary holds at full split.
- `artisan-quests` fleshed out into a **full 3-layer** module: bespoke editor (graph/timeline of quest chains), backend (routes + tables + migrations), plugin runtime (objectives/rewards, data sources/commands).
- E2E presence activation; build of the hosted **distribution** including quests; JAR on the `depend:[Artisan]` pattern + `isCompatibleWith(MIN_CORE_API_VERSION)` check.

**Exit criterion**: an admin who installs the quests JAR sees and edits a full quests module; the quests editor/backend/plugin code lives **entirely** in `artisan-quests`, consuming only the versioned SDKs.

## 6. Risks & open questions

- **Cross-repo dev-loop under Windows** (Gradle composite + `npm link`) — **de-risked in P1 by construction** (it is the object of the tracer bullet).
- **Module routes ↔ TanStack file-based reconciliation** — decided in the P3 plan (two tracks above).
- **Module DB migrations in multi-tenant** (application order, isolation per network, rollback) — mechanism defined in P3, exposed in `@artisan/backend-sdk`.
- **Private registry**: GitHub Packages (default, `2026-06-15` §13) vs self-hosted Verdaccio — decided in P1.
- **SDK surface too wide** → frequent cross-repo bumps — mitigation: dogfooding (P2/P3) + aggressive `@Internal` + surface review.

## 7. Out of scope (unchanged)

- **Third-party** modules (external devs), **runtime federation**, **licensing/billing** (deferred), **customer self-host** of the editor/backend. The lazy-`import()` seam (P1/P3) **prepares** runtime federation but does not implement it.
