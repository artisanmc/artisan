# Artisan — Claude instructions

This file is a **router**: the operational bits (commands, pitfalls) plus where to find the detail.
It stays short on purpose — the detail lives in `docs/`, read when the task touches it.

## Agent skills

### Issue tracker

Tickets and PRDs live in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

The five standard statuses are used. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repository: `CONTEXT.md` and `docs/decisions/`. See `docs/agents/domain.md`.

## Docs update rule

When you change code, update the matching docs. **The source-of-truth mapping is
`.claude/skills/sync-docs/doc-impact-map.yaml`** (which touched file → which docs to update) —
read it, do not guess it.

- Small update (one or two existing sections, ≲30 lines of doc diff) → **same commit** as the code.
- Large update, or one needing screenshots / a rewrite → `/sync-docs` skill at the end of the feature, separate commit.
- Never merge with unlisted doc debt.

Not updating = the next session will not know the code changed.

## Reference docs

| Doc | Contents |
|---|---|
| `CONTEXT.md` | Domain glossary — **source of truth for terms**. |
| `docs/architecture/invariants.md` | The critical invariants in detail (disk, CAS, exclusions, threads). |
| `docs/architecture/modules.md` | Modular monolith: module abstraction, data sources + commands, how to add one. |
| `docs/architecture/versioning.md` | The disciplines (CHANGELOG, versioned schemas, protocol version, REST `/api/v1/`). |
| `docs/architecture/api-surface.md` | Stable public API surface (`@Stable`/`@Beta`/`@Internal`/`@Sunset`). |
| `docs/architecture/ws-protocol.md` | Hub ↔ server messages (`/ws/plugin`) + `/ws/editor`. |
| `docs/architecture/rest-endpoints.md` | Index of the hub's routes (which `*Routes.kt` to open) + conventions. |
| `docs/architecture/entities.md` | What persists where (disk, suite database, hub memory), auth, history. |
| `docs/architecture/editor-internals.md` | Title composer, Document editing, canvas, UI shell, design system. |
| `docs/architecture/project-files.md` | Layout of a project on disk, `lang/` codec, `title` field. |
| `docs/architecture/plugin-commands.md` | Detail of the `/artisan` subcommands. |
| `docs/architecture/testing.md` | Suite coverage + conformance vectors. |
| `docs/architecture/schemas-codegen.md` | JSON schemas ↔ editor/plugin types. |
| `docs/decisions/` | ADRs (`editor-web-server`: the hub). `docs/specs/`: product specs; `docs/archive/specs/`: past designs (see its README). |

## Commands

```bash
# Plugin (Kotlin 2.0 / Paper 1.21+, Folia, Leaf)
cd plugin
./gradlew test          # every module (api, core, database, hub, paper)
./gradlew shadowJar     # → paper/build/libs/artisan-plugin-1.0.0-SNAPSHOT-all.jar
./gradlew shadowJar -PwithEditor   # same, with the editor and the 3D icons bundled (npm required)
./gradlew deploy        # build + restart the container

# Editor (React 19 + Vite 6)
cd editor
npm run dev             # port 5173, /api and /ws proxied to the hub (ARTISAN_HUB_URL, default :8765)
npm test
npm run build           # the build served by the hub (called by -PwithEditor)
npm run build:site      # artisanmc.net showcase + wiki (editor/Dockerfile)

# Local server
docker compose up       # Paper :25565 + plugin editor :8765 + the shop's MySQL
docker compose -f docker/network/compose.yml up   # network: one hub + one leaf
```

**Plugin commands** — `/artisan menu|reload|sync|editor [sessions|revoke <id>|logout]|dump-title`, detail in
`docs/architecture/plugin-commands.md`.

**MC assets** — `cd tools/minecraft-assets && bun gen-items.ts [version]` → `gen-icons.ts` → `pack-icons.ts`
(→ `items/<version>.json` + `icons/icons-<version>.zip`, **to be committed**; the hub bundles them in the
jar). Detail: `tools/minecraft-assets/README.md`.

## Architecture

```
editor/          React 19 + Vite + Konva — served by the plugin (hub)
plugin/          Kotlin 2.0 + Paper: api · core · database · hub (Jetty 12) · paper
docker/          Local Minecraft servers (itzg/minecraft-server), network in docker/network/
tools/minecraft-assets/  Bun generators for vanilla MC assets (items, 3D icons, glyph widths, padded fonts)
docs/site/       Public user docs (EN, Starlight Markdown) — assembled by artisanmc.net
docs-site/       Astro Starlight build of docs/site/, served at artisanmc.net/wiki
docs/            architecture/ · archive/ · decisions/ · specs/ · schema/
```

**No backend** — the plugin serves the editor, the `/api/v1/…` API and the WebSockets on `web.port`
(8765). Sign-in through the link from `/artisan editor`. Network: one server with `web.role: hub`, the
others `leaf`, connected to its `/ws/plugin` with a shared secret. ADR `editor-web-server`.

**Plugin as Gradle modules** — `plugin/api` (add-on surface, **in Java**: API 2.0.0), `plugin/core` (domain, no Bukkit),
`plugin/database`, `plugin/hub` (web server, no Bukkit), `plugin/runtime` (action engine, conditions, items,
translations), `plugin/paper` (menus, presence, jar). An
`org.bukkit` import outside `paper`, `runtime` or `api` does not compile. Detail: `plugin/README.md`, ADRs `plugin-gradle-modules`,
`runtime-library`.

**Modular monolith** — each module lives in 2 symmetric layers:
`plugin/…/modules/{id}/` (`ArtisanModule` impl) and `editor/src/modules/{id}/` (`FrontendModule`).
Cross-module communication only through `DataSourceRegistry` and `CommandRegistry` — no direct
dependency. **An `ArtisanModule` only imports from `net.artisanmc.modules.api.*`**, never from
`net.artisanmc.plugin.*` (implicitly `@Internal`). Adding a module: `docs/architecture/modules.md`.

## Costly pitfalls

The three we cannot afford to discover after the fact. The rest — and the detail of
these — in **`docs/architecture/invariants.md`**.

1. **Published content lives on the server's disk, the rest in the suite database** — only
   the server writes its files (`project_write` or publishing a draft, compare-and-swap).
   The database keeps what each server loaded (`artisan_servers`, Versions,
   `artisan_server_state`) and the private drafts (`artisan_drafts`, one set per player UUID,
   autosave): the hub reads and edits from the database, even with the server off; only writes and
   live data go to the server (ADR `server-identity-and-versions`).
2. **`.artisan*` as first segment = metadata** — outside the hash, invisible to the disk scan. The editor
   owns `.artisan/editor.yaml` (it may write it); `.artisan/history/`, `.artisan/drafts/`, `.artisan/project-id`, `.artisan/origins.yaml`,
   `.artisan-trash/` and `.artisan-sync.yaml` stay invisible to it **and** off-limits for writing.
3. **Threads: Paper, Folia, Leaf** — never `Bukkit.getScheduler()`: everything goes through the
   `Scheduler` port. Jetty answers on its own threads; any game access from the hub goes back through
   the scheduler.

## Editor design system

All new UI work goes **first** through the design system (specimen at `/design`):

1. Components in `editor/src/components/ui/` or the utility classes of `globals.css` (`.btn*`, `.input`,
   `.card`, `.chip`, `.badge*`, `.tab`, `.eyebrow`, `.field-label`…) first.
2. Missing component → create it in `components/ui/` + add its specimen to `/design`
   in the same commit. No duplicated ad-hoc styling.
3. Colors only through `var(--token)`, never hard-coded hex/rgba. Exception: the Konva canvas.

UI strings go through react-i18next (`en.ts` + `fr.ts` in the same commit) — never hard-coded
French/English in JSX.
