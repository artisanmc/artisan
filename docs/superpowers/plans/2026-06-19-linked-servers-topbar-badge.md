# Linked-servers topbar badge + dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-server `ServerStatusBadge` in the project topbar with a network-scoped badge (`online/total`) + dropdown listing every server key with online/offline state, last-seen time, last IP, and MC version.

**Architecture:** One polled, read-only backend endpoint (`GET /api/v1/networks/:id/servers-status`) aggregates server keys + last accepted hello + in-memory instance count. A new `LinkedServersDropdown` component renders the badge and list, polling every 15s, and replaces `ServerStatusBadge`.

**Tech Stack:** Backend Bun + Hono + Drizzle (PostgreSQL). Editor React 19 + Vite, design-system `DropdownMenu`/`Badge`, react-i18next.

## Global Constraints

- **Rename overlap:** This touches files mid-refactor by the in-progress `pack→project` rename (`userNetworks.ts`, `ProjectTopBarControls.tsx`, `lib/api/networks.ts`). Execute **only after that rename merges to `main`**, on a **dedicated branch off `main`**. Before each edit, verify current symbol names — use the post-rename vocabulary (`project`/`projects`/`serverKeyId`); if a symbol is still `pack`, match the file's actual current name.
- **No `bun test` direct** — always `bun run test` (wrapper isolates `artisan_test`; direct wipes dev DB).
- **Backend tests:** `cd backend && bun run test`. **Editor tests:** `cd editor && npm test`.
- **i18n:** every user-facing string goes through react-i18next; add keys to BOTH `editor/src/locales/en.ts` and `editor/src/locales/fr.ts` in the same commit. No hardcoded FR/EN in JSX.
- **Design system first:** use `components/ui/DropdownMenu` + `Badge`; colours via `var(--token)` only, no hex/rgba.
- **Read-only:** no rotate/rename/disconnect actions in this iteration.
- **No port:** port is not captured; display IP only.
- **Git staging:** stage exact paths only (repo carries standing WIP); never `git add -A`.

---

### Task 1: Backend `servers-status` endpoint

**Files:**
- Modify: `backend/src/routes/userNetworks.ts` (add route after the `/:id/server-keys/:keyId/status` handler, ~line 533; extend imports)
- Modify: `docs/architecture/rest-endpoints.md` (index entry for the new route)
- Test: `backend/src/routes/userNetworks.test.ts`

**Interfaces:**
- Consumes: existing helpers in `userNetworks.ts` — `getUserId(c)`, `requireMember(userId, networkId)`, `getInstanceCount(keyId)` (already imported from `../ws/hub`), `serverKeys` (schema), drizzle `and`/`eq`.
- Produces: `GET /api/v1/networks/:id/servers-status?current=<serverKeyId>` returning
  ```ts
  {
    servers: Array<{
      id: string; label: string | null;
      online: boolean; instanceCount: number;
      lastMcVersion: string | null;
      lastSeenAt: string | null; lastSeenIp: string | null;
      isCurrent: boolean;
    }>;
    online: number; total: number;
  }
  ```

- [ ] **Step 1: Extend imports**

In `backend/src/routes/userNetworks.ts`, add `serverKeyHelloes` to the schema import and `desc`, `inArray`, `isNull` to the existing `drizzle-orm` import (alongside `and`, `eq`). Confirm `serverKeys` and `serverKeyHelloes` both come from the same schema module already used in the file.

- [ ] **Step 2: Write the failing test**

Append to `backend/src/routes/userNetworks.test.ts`, reusing the seed helpers already used by that file (e.g. the existing user/network/membership/server-key creation helpers — match their actual names in the file):

```ts
it("GET /:id/servers-status returns total, last-seen, and ignores rejected helloes", async () => {
  const { user, cookie } = await seedUser();              // existing helper
  const networkId = await seedNetwork(user.id);           // existing helper, makes user owner/member
  const keyA = await seedServerKey(networkId, { label: "Survival" });   // existing helper → returns id
  const keyB = await seedServerKey(networkId, { label: "Lobby" });

  const now = new Date();
  const earlier = new Date(now.getTime() - 60_000);
  // keyA: one accepted hello (earlier) + one rejected hello (now) — accepted must win, rejected ignored
  await db.insert(serverKeyHelloes).values([
    { id: crypto.randomUUID(), serverKeyId: keyA, ip: "1.2.3.4", mcVersion: "1.21.4", helloAt: earlier, rejectedReason: null },
    { id: crypto.randomUUID(), serverKeyId: keyA, ip: "9.9.9.9", mcVersion: "1.21.4", helloAt: now, rejectedReason: "ip_not_allowed" },
  ]);
  // keyB: never connected → no hello rows

  const res = await app.request(`/api/v1/networks/${networkId}/servers-status?current=${keyA}`, {
    headers: { cookie },
  });
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.total).toBe(2);
  expect(body.online).toBe(0); // no live WS connections in test

  const a = body.servers.find((s: any) => s.id === keyA);
  const b = body.servers.find((s: any) => s.id === keyB);
  expect(a.lastSeenIp).toBe("1.2.3.4");                 // accepted hello, NOT the rejected one
  expect(new Date(a.lastSeenAt).getTime()).toBe(earlier.getTime());
  expect(a.isCurrent).toBe(true);
  expect(b.isCurrent).toBe(false);
  expect(b.lastSeenAt).toBeNull();                       // never connected
  expect(b.lastSeenIp).toBeNull();
});

it("GET /:id/servers-status is 403 for non-members", async () => {
  const owner = await seedUser();
  const networkId = await seedNetwork(owner.user.id);
  const stranger = await seedUser();
  const res = await app.request(`/api/v1/networks/${networkId}/servers-status`, {
    headers: { cookie: stranger.cookie },
  });
  expect(res.status).toBe(403);
});
```

If the file's seed helpers have different names/signatures, adapt these calls to match — do not invent new helpers.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && bun run test -- userNetworks`
Expected: FAIL (route returns 404 — endpoint not defined yet).

- [ ] **Step 4: Implement the endpoint**

Insert after the `/:id/server-keys/:keyId/status` handler:

```ts
// GET /api/networks/:id/servers-status — member access. Read-only aggregate
// for the topbar linked-servers badge + dropdown: one row per server key with
// live online state (in-memory instance count) and last *accepted* hello.
userNetworksRouter.get(
	"/:id/servers-status",
	async (c: Context<{ Variables: Vars }>) => {
		const userId = getUserId(c);
		if (!userId) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.param("id");
		const current = c.req.query("current") ?? null;
		try {
			await requireMember(userId, networkId);
		} catch {
			return c.json({ error: "forbidden" }, 403);
		}

		const keys = await db
			.select()
			.from(serverKeys)
			.where(eq(serverKeys.networkId, networkId));

		const ids = keys.map((k) => k.id);
		const lastHelloes = ids.length
			? await db
					.selectDistinctOn([serverKeyHelloes.serverKeyId], {
						serverKeyId: serverKeyHelloes.serverKeyId,
						ip: serverKeyHelloes.ip,
						helloAt: serverKeyHelloes.helloAt,
					})
					.from(serverKeyHelloes)
					.where(
						and(
							inArray(serverKeyHelloes.serverKeyId, ids),
							isNull(serverKeyHelloes.rejectedReason),
						),
					)
					.orderBy(
						serverKeyHelloes.serverKeyId,
						desc(serverKeyHelloes.helloAt),
					)
			: [];
		const helloById = new Map(lastHelloes.map((h) => [h.serverKeyId, h]));

		const servers = keys.map((k) => {
			const instanceCount = getInstanceCount(k.id);
			const hello = helloById.get(k.id);
			return {
				id: k.id,
				label: k.label,
				online: instanceCount > 0,
				instanceCount,
				lastMcVersion: k.lastMcVersion,
				lastSeenAt: hello ? hello.helloAt.toISOString() : null,
				lastSeenIp: hello ? hello.ip : null,
				isCurrent: k.id === current,
			};
		});
		const online = servers.filter((s) => s.online).length;
		return c.json({ servers, online, total: servers.length });
	},
);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && bun run test -- userNetworks`
Expected: PASS (both new tests + existing suite green).

- [ ] **Step 6: Update REST docs**

In `docs/architecture/rest-endpoints.md`, add a row under the networks section pointing at `userNetworks.ts`:
`GET /api/v1/networks/:id/servers-status?current=<serverKeyId>` — member; topbar linked-servers aggregate (online/total + per-server last accepted hello). Read-only.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts docs/architecture/rest-endpoints.md
git commit -m "feat(backend): network servers-status aggregate endpoint"
```

---

### Task 2: Editor API client + types

**Files:**
- Modify: `editor/src/lib/api/networks.ts`

**Interfaces:**
- Consumes: existing `API_URL` constant + `fetch(..., { credentials: "include" })` pattern in this file.
- Produces:
  ```ts
  export interface ServerStatusEntry { id: string; label: string | null; online: boolean; instanceCount: number; lastMcVersion: string | null; lastSeenAt: string | null; lastSeenIp: string | null; isCurrent: boolean; }
  export interface NetworkServersStatus { servers: ServerStatusEntry[]; online: number; total: number; }
  export function getNetworkServersStatus(networkId: string, currentServerKeyId?: string): Promise<NetworkServersStatus>;
  ```

- [ ] **Step 1: Add types + fetcher**

Append to `editor/src/lib/api/networks.ts`:

```ts
export interface ServerStatusEntry {
  id: string;
  label: string | null;
  online: boolean;
  instanceCount: number;
  lastMcVersion: string | null;
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  isCurrent: boolean;
}

export interface NetworkServersStatus {
  servers: ServerStatusEntry[];
  online: number;
  total: number;
}

export async function getNetworkServersStatus(
  networkId: string,
  currentServerKeyId?: string,
): Promise<NetworkServersStatus> {
  const q = currentServerKeyId
    ? `?current=${encodeURIComponent(currentServerKeyId)}`
    : "";
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/servers-status${q}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`getNetworkServersStatus failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Type-check**

Run: `cd editor && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add editor/src/lib/api/networks.ts
git commit -m "feat(editor): getNetworkServersStatus API client"
```

---

### Task 3: `LinkedServersDropdown` component + i18n

**Files:**
- Create: `editor/src/components/LinkedServersDropdown.tsx`
- Create: `editor/src/components/LinkedServersDropdown.test.tsx`
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`

**Interfaces:**
- Consumes: `getNetworkServersStatus`, `NetworkServersStatus` (Task 2); `DropdownMenu` + `Badge` from `components/ui`.
- Produces: `export function LinkedServersDropdown(props: { networkId: string; currentServerKeyId?: string }): JSX.Element`

- [ ] **Step 1: Add i18n keys**

In `editor/src/locales/en.ts`, add under the top-level translation object:

```ts
servers: {
  count: "{{online}}/{{total}}",
  title: "Linked servers",
  online: "Online",
  current: "current",
  instances: "×{{count}}",
  lastSeen: "Last seen {{when}}",
  neverConnected: "Never connected",
  empty: "No servers linked",
},
```

In `editor/src/locales/fr.ts`, the mirror:

```ts
servers: {
  count: "{{online}}/{{total}}",
  title: "Serveurs liés",
  online: "En ligne",
  current: "courant",
  instances: "×{{count}}",
  lastSeen: "Vu {{when}}",
  neverConnected: "Jamais connecté",
  empty: "Aucun serveur lié",
},
```

- [ ] **Step 2: Write the failing test**

Create `editor/src/components/LinkedServersDropdown.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinkedServersDropdown } from "./LinkedServersDropdown";
import * as api from "@/lib/api/networks";

vi.mock("@/lib/api/networks");

describe("LinkedServersDropdown", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders online/total in the badge", async () => {
    vi.spyOn(api, "getNetworkServersStatus").mockResolvedValue({
      online: 2,
      total: 3,
      servers: [
        { id: "a", label: "Survival", online: true, instanceCount: 1, lastMcVersion: "1.21.4", lastSeenAt: new Date().toISOString(), lastSeenIp: "1.2.3.4", isCurrent: true },
        { id: "b", label: "Lobby", online: true, instanceCount: 2, lastMcVersion: "1.21.4", lastSeenAt: new Date().toISOString(), lastSeenIp: "1.2.3.5", isCurrent: false },
        { id: "c", label: "Events", online: false, instanceCount: 0, lastMcVersion: null, lastSeenAt: null, lastSeenIp: null, isCurrent: false },
      ],
    });

    render(<LinkedServersDropdown networkId="net1" currentServerKeyId="a" />);
    expect(await screen.findByText("2/3")).toBeInTheDocument();
  });

  it("shows never-connected for a server with no hello", async () => {
    vi.spyOn(api, "getNetworkServersStatus").mockResolvedValue({
      online: 0,
      total: 1,
      servers: [
        { id: "c", label: "Events", online: false, instanceCount: 0, lastMcVersion: null, lastSeenAt: null, lastSeenIp: null, isCurrent: false },
      ],
    });
    render(<LinkedServersDropdown networkId="net1" />);
    expect(await screen.findByText("0/1")).toBeInTheDocument();
    // The dropdown content renders its rows; assert the never-connected label is present in the DOM.
    expect(await screen.findByText("Never connected")).toBeInTheDocument();
  });
});
```

Note: if the design-system `DropdownMenu` renders content lazily (only on open), the second test must open the menu first (`fireEvent.click(screen.getByRole("button"))`) before querying the row — adjust to match the `DropdownMenu` behaviour observed in other component tests in the repo.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd editor && npm test -- LinkedServersDropdown`
Expected: FAIL (component not found).

- [ ] **Step 4: Implement the component**

Create `editor/src/components/LinkedServersDropdown.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Badge } from "@/components/ui/Badge";
import {
  getNetworkServersStatus,
  type NetworkServersStatus,
  type ServerStatusEntry,
} from "@/lib/api/networks";

const POLL_MS = 15_000;

/** Relative "x ago" using the active editor language. */
function relTime(iso: string, lang: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const mins = Math.round(diffMs / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

export function LinkedServersDropdown(props: {
  networkId: string;
  currentServerKeyId?: string;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<NetworkServersStatus | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      getNetworkServersStatus(props.networkId, props.currentServerKeyId)
        .then((d) => {
          if (active) setData(d);
        })
        .catch(() => {});
    load();
    const h = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(h);
    };
  }, [props.networkId, props.currentServerKeyId]);

  const online = data?.online ?? 0;
  const total = data?.total ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="chip" aria-label={t("servers.title")}>
          <span
            className="size-2 rounded-full"
            style={{
              background:
                online > 0 ? "var(--color-success)" : "var(--color-muted)",
            }}
          />
          <Badge>{t("servers.count", { online, total })}</Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-64">
        <div className="eyebrow px-2 py-1">{t("servers.title")}</div>
        {total === 0 && (
          <div className="px-2 py-2 text-sm">{t("servers.empty")}</div>
        )}
        {data?.servers.map((s) => (
          <ServerRow key={s.id} s={s} lang={i18n.language} t={t} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ServerRow(props: {
  s: ServerStatusEntry;
  lang: string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const { s, lang, t } = props;
  return (
    <div className="flex flex-col gap-0.5 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span
          className="size-2 rounded-full"
          style={{
            background: s.online
              ? "var(--color-success)"
              : "var(--color-muted)",
          }}
        />
        <span className="font-medium">{s.label ?? s.id.slice(0, 8)}</span>
        {s.isCurrent && <Badge>{t("servers.current")}</Badge>}
      </div>
      <div className="pl-4 text-xs" style={{ color: "var(--color-fg-muted)" }}>
        {s.online ? (
          <>
            {t("servers.online")}
            {s.instanceCount > 1 &&
              ` ${t("servers.instances", { count: s.instanceCount })}`}
            {s.lastSeenIp && ` · ${s.lastSeenIp}`}
            {s.lastMcVersion && ` · ${s.lastMcVersion}`}
          </>
        ) : s.lastSeenAt ? (
          <>
            {t("servers.lastSeen", { when: relTime(s.lastSeenAt, lang) })}
            {s.lastSeenIp && ` · ${s.lastSeenIp}`}
          </>
        ) : (
          t("servers.neverConnected")
        )}
      </div>
    </div>
  );
}
```

Adjust import paths/exports for `DropdownMenu`/`Badge` to match their actual export names in `components/ui` (check `ServerStatusBadge.tsx` and `/admin/design` specimens for the exact API). If `--color-success`/`--color-muted`/`--color-fg-muted` tokens differ, use the actual semantic tokens defined in `globals.css`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd editor && npm test -- LinkedServersDropdown`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add editor/src/components/LinkedServersDropdown.tsx editor/src/components/LinkedServersDropdown.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): LinkedServersDropdown component + i18n"
```

---

### Task 4: Wire into topbar, remove `ServerStatusBadge`

**Files:**
- Modify: `editor/src/components/ProjectTopBarControls.tsx` (~line 118, replace the `<ServerStatusBadge .../>` usage)
- Delete: `editor/src/components/ServerStatusBadge.tsx`
- Delete: `editor/src/components/ServerStatusBadge.test.tsx` if one exists

**Interfaces:**
- Consumes: `LinkedServersDropdown` (Task 3). The current target server id comes from the project object already in scope (post-rename: `project.serverKeyId`; if still `pack.serverKeyId`, use that). `networkId` is already a prop/param in this component.

- [ ] **Step 1: Confirm `ServerStatusBadge` has no other consumers**

Run: `cd editor && rg -n "ServerStatusBadge" src`
Expected: only `ProjectTopBarControls.tsx` (import + usage) and the badge's own files. If used elsewhere, stop and reassess.

- [ ] **Step 2: Swap the component**

In `ProjectTopBarControls.tsx`, remove the `ServerStatusBadge` import and replace its JSX usage with:

```tsx
<LinkedServersDropdown
  networkId={networkId}
  currentServerKeyId={project.serverKeyId}
/>
```

(use the in-scope project/pack variable name) and add `import { LinkedServersDropdown } from "@/components/LinkedServersDropdown";`.

- [ ] **Step 3: Delete the old badge**

```bash
git rm editor/src/components/ServerStatusBadge.tsx
# also remove its test if present:
git rm editor/src/components/ServerStatusBadge.test.tsx 2>/dev/null || true
```

- [ ] **Step 4: Type-check + run editor suite**

Run: `cd editor && npx tsc --noEmit && npm test`
Expected: no type errors; full suite green (no dangling `ServerStatusBadge` references).

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/ProjectTopBarControls.tsx
git commit -m "feat(editor): topbar uses LinkedServersDropdown, drop ServerStatusBadge"
```

---

## Self-Review

- **Spec coverage:** badge `online/total` → Task 3 component + Task 1 counts ✓; dropdown list w/ online/offline/IP/version/last-seen → Task 3 `ServerRow` + Task 1 fields ✓; disconnected + last-seen via hello audit → Task 1 (last accepted hello) ✓; current-server marker → `isCurrent` (Task 1) + Task 3 badge ✓; replace `ServerStatusBadge` → Task 4 ✓; read-only / no port / network-scoped → respected throughout ✓; REST docs → Task 1 Step 6 ✓.
- **Placeholder scan:** code provided for every code step; the two "adapt to existing helper/token names" notes are pattern-matching instructions against real, named files, not deferred work.
- **Type consistency:** `ServerStatusEntry`/`NetworkServersStatus` defined in Task 2, consumed identically in Task 3; backend response shape (Task 1) matches the frontend interface field-for-field (`lastSeenAt`/`lastSeenIp`/`instanceCount`/`isCurrent`).
