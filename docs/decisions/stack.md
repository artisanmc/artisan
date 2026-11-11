# Artisan — Technical stack

Consolidated decisions on the product's stack, with rationale and rejected alternatives. Living document: update it when a choice is revisited.

Last revision: 2026-06-19.

> **Phase F (2026-10)**: the backend (Bun, Hono, Drizzle, PostgreSQL), emails, Google/Discord and OVH/Coolify hosting are removed. The editor is served by the plugin with Jetty 12 (ADR [editor-web-server](editor-web-server.md)); the pack is built in the browser. The corresponding lines below are historical.

---

## Summary in a table

| Layer | Choice | Rejected alternative | Why |
|---|---|---|---|
| **Minecraft plugin** | Kotlin 2.0 + Paper API + Gradle | Java 21 | Kotlin offers null-safety, data classes and coroutines — less boilerplate for complex domain models. |
| **Backend runtime** | Bun 1.x | Node 22, Deno | Fast startup, native TypeScript without transpilation, built-in `bun:sqlite`. Enough for the MVP and prod at low concurrency. |
| **Backend framework** | Hono 4 | Fastify, Express | Lightweight, TypeScript-first, WebSocket via `hono/bun`. Zero config. For the MVP, Fastify brings nothing concrete. |
| **ORM** | Drizzle | Sequelize, Prisma | TS-native, perfect types, close to SQL, no codegen nor separate engine. Swappable dialect (SQLite → PostgreSQL by changing 3 lines). |
| **DB** | PostgreSQL 16 (`drizzle-orm/postgres-js`) | SQLite (`bun:sqlite`) | Multi-tenant SaaS: data visualization, backups, ad-hoc queries, multi-instance preparation. Drizzle abstracts the dialect — the switch from SQLite only needed 3 lines of config. |
| **Editor canvas** | Konva + react-konva | React Flow | A single Konva canvas with inline inventories. React Flow (node-based) does not match the visual model: menus are not connected nodes, they are compositions of items in a grid. |
| **WS client (editor)** | Custom `pluginBridge.ts` (~60 LOC) | partysocket, socket.io | We control the JSON protocol. partysocket is only useful if you want auto-reconnect without writing it — 60 lines are enough. *Removed since (issue #44): `pluginBridge.ts` had no importer left once the editor was served by the plugin; `lib/editorWs.ts` carries the `/ws/editor` socket.* |
| **WS client (plugin)** | OkHttp 4 WebSocket | socket.io, Ktor | OkHttp is already the plugin's HTTP dependency (bundle download). A single HTTP+WS client. Exponential backoff reconnect included. |
| **Frontend framework** | React 19 + strict TypeScript | Vue, Svelte, Solid | Ecosystem (@dnd-kit, shadcn, LLM training data). |
| **Build** | Vite 6 | webpack, Parcel, Turbopack | 2026 standard. Fast HMR, minimal config. |
| **Router** | TanStack Router | React Router v7 | Type-safe routes/params. |
| **Client state** | Zustand + Zundo | Jotai, Redux Toolkit | Clear store for an editor with a large state graph. Zundo = free undo/redo. |
| **UI components** | shadcn/ui + Tailwind v4 | Mantine, Chakra UI | We own the code. Free customization, polished design. |
| **Drag & drop** | @dnd-kit/core | react-beautiful-dnd | Performant, accessible, maintained. |
| **MiniMessage** | Custom TS parser (~500 LOC) | npm @minecraft-js/minimessage, adventure-webui | Zero dependencies, native integration with i18n/PAPI autocomplete. adventure-webui serves as a visual reference (MIT). |
| **Backend tests** | `bun:test` | Vitest, Jest | Bun-native, zero config. |
| **PNG button resizing** | `pngjs` 7 | Native image processing dependency | Pure JS PNG decode/encode on Bun, nearest-neighbour scaling and transparent padding for multi-slot buttons; no native binary installation. |
| **Resource pack (editor)** | `fflate` 0.8.2 + in-house PNG/deflate (`editor/src/lib/pack/`) | `pngjs`, `crypto.subtle` | The pack is also built in the browser. `pngjs` depends on Node, `crypto.subtle` requires HTTPS: PNG, deflate Z_RLE and SHA-1 in pure JS, byte-for-byte identical to `pngjs` + zlib on the backend side. |
| **Google ID tokens** | `jose` 6 (RS256 + cached remote Google JWKS) | Hand-written JWT/signature verification | Standard verification of issuer, audience and expiry on Bun; Google authorization-code flow additionally binds state, nonce and PKCE. |
| **Editor tests** | Vitest + Playwright | Jest, Cypress | Vitest integrates with Vite. Playwright > Cypress in 2026. |
| **Plugin tests** | JUnit 5 + MockBukkit + MockWebServer | - | Paper/Bukkit standards. MockWebServer (OkHttp) to simulate the backend in integration. |
| **Lint / format** | Biome (editor) | ESLint + Prettier | A single binary, faster. |
| **Production hosting** | OVH VPS 4 vCPU/8 GB, Ubuntu 26.04, Coolify, private PostgreSQL 16, nginx, Cloudflare Tunnel + Access, gated GitHub Actions delivery | Managed hosting spread across providers | A consolidated stack reduces operational fragmentation while staying operable by a single person. The Tunnel hides the origin and avoids exposing inbound web ports. |
| **Transactional emails** | Scaleway TEM via SMTP (nodemailer) — 2026-07-11 | Dedicated HTTP API | SMTP is enough for a low transactional volume (welcome, notifications); nodemailer is zero-config on `createTransport`, no additional proprietary SDK. |

---

## Pivots since the initial spec (April 2026)

The initial spec documented Node 22 + Fastify + PostgreSQL + React Flow. The implementation diverged on four points — decisions made in May 2026 during scaffolding:

| Initial spec | Implemented | Reason for the pivot |
|---|---|---|
| Java 21 | **Kotlin 2.0** | Null-safety and data classes reduce boilerplate on domain models. |
| Node 22 + Fastify | **Bun + Hono** | MVP: Bun simplifies the toolchain (no transpilation). Fastify brings nothing concrete at this scale. |
| React Flow | **Konva** | The visual model is a canvas of Minecraft inventories, not a node graph. Konva gives the pixel-perfect control needed. |
| Projects only on the Minecraft disk | **Two adapters, durable hosted volume + Minecraft disk** | Prepare a project without a server; same CAS/drafts, single authority and SQL + volume backup. ADR `project-storage-modes`. |
| Managed hosting spread across several providers | **OVH + Coolify + private PostgreSQL + nginx + Cloudflare Tunnel/Access** | Less operational fragmentation and more practical solo operation, with releases still gated by GitHub Actions CI. |

**Condition for migrating to Fastify:** if we need the JSON Schema validation built into the bundle upload routes (when the menu v2 schema arrives), or if we hit Hono's limits in production.

---

## Backend — details

### Bun + Hono

Bun runs native TypeScript, exposes `bun:sqlite` without a dependency, and `Bun.serve` handles HTTP + WebSocket in the same process. Hono is an ultra-light HTTP framework with an API close to Express — `createBunWebSocket()` integrates the WS upgrade cleanly.

```ts
const { upgradeWebSocket, websocket } = createBunWebSocket();
app.get("/ws/plugin", upgradeWebSocket(() => ({
  onMessage(evt, ws) { ... },
  onClose() { ... },
})));
export default { port, fetch: app.fetch, websocket };
```

### PostgreSQL + Drizzle

```ts
// db/index.ts
const client = postgres(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/artisan");
export const db = drizzle(client, { schema });
```

The switch from SQLite only required: replacing `drizzle-orm/bun-sqlite` with `drizzle-orm/postgres-js`, changing the dialect in `drizzle.config.ts`, and `sqliteTable` → `pgTable` in the schema. The Drizzle queries did not change.

### WS sessions

Sessions are in memory (`activeSessions`, `sessionSenders` in `hub.ts`). This is enough for a single-instance backend. If we go multi-instance, a shared layer will be needed (Redis or a PostgreSQL table).

---

## Frontend — details

### Konva

The canvas is a single Konva `<Stage>`. Menus are `<Group>`s positioned with `menuLayout.ts`, items are `<Rect>` + `<Image>`, MiniMessage text rendered in MC bitmap font by `VanillaMcText.tsx` (or `McFontText.tsx` for an imported font). Pan/zoom handled by `usePanZoom.ts`.

No React Flow: Artisan menus are not nodes in a graph. They are compositions of items in a grid. The visual "edges" between menus (`open_menu` actions) are rendered custom with `deriveEdges.ts`.

### Zustand + Zundo

`accountStore.ts` is the main store — its mutations live by domain in `state/account/*Slice.ts` (projects, dialogs, commands, menus, elements, canvas, i18n, data), composed under Zundo for undo/redo (issue #46). `uiStore.ts` carries pure UI state (active tab, language, dimensions). `wsStore.ts` used to carry the WS connection and the `publish()` function; removed with `pluginBridge.ts` (issue #44).

TanStack Query is not used (no server-side data fetching on the editor side in the MVP — state lives in localStorage).

---

## Plugin — details

### Kotlin 2.0 + OkHttp

`WsClient.kt` handles the WS connection with exponential reconnect. The bundle download (`BundleDownloader.kt`) runs on `httpClient.dispatcher.executorService` so as not to block OkHttp's WS callback thread.

`SyncedMenuProvider.kt` is the single entry point: loads menus from disk, opens the WS if `server_key` is configured, handles live-reload on `bundle_available`.

### Deterministic hash

`BundleHasher.kt` and `hashUtils.ts` must produce the same hash for the same files. Critical invariant: **byte-order sort** (native Kotlin/JS `<`/`>`), not `localeCompare` nor locale-aware `compareTo`. The empty string `""` is the universal sentinel for "no content".

---

## Hosting (production target)

- **Plugin**: distributed to admins, not hosted by us.
- **Host**: OVH VPS 4 vCPU / 8 GB on Ubuntu 26.04, administered by Coolify.
- **Backend**: Bun Docker image managed by Coolify, persistent volume `/app/data`.
- **Editor + showcase + wiki**: a multi-stage Docker image, static files served by nginx. Astro Starlight compiles the wiki under `/wiki/`; the React routes stay at the root. The editor build includes the guides and the Pagefind index, with no additional service in production.
- **Data**: private PostgreSQL 16 on the Coolify network; assets and bundles on `/app/data` backed up off-host.
- **Web entry**: named Cloudflare Tunnel for `api.artisanmc.net`, `editor.artisanmc.net` and `coolify.artisanmc.net`; Cloudflare Access protects Coolify.
- **Delivery**: GitHub Actions deploys only the `main` revision validated by CI; Coolify's direct auto-deploy is disabled.
- **Auth**: custom Discord OAuth (not NextAuth — bound to Next.js).
- **Payment**: Stripe Subscriptions.

---

## Assistant Markdown rendering

The editor uses `react-markdown` and `remark-gfm` to display AI responses
(CommonMark and GFM tables) in the chat and the task tracking. The rendering produces
React elements, ignores raw HTML and keeps the default URL filtering.

## Still-open items

- **Bundle signing**: `signature` field present in the protocol, not implemented. ECDSA P-256 planned.
- **Auth**: not implemented. Manual `server_key` for now. Two providers planned: Discord OAuth + email/password (bcrypt + JWT). `server_key` remains the plugin → backend auth vector (does not change).
- **TanStack Query**: not used. To be introduced if we add server-side data fetching (billing, teams).
- **Menu JSON migration v1 → v2**: engine on the plugin side only, on the backend side, or both? To be settled in V1.5.
- **PlaceholderAPI**: direct integration for V1, abstraction if rich auto-completion is needed.
