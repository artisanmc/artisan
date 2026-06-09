# Feature IA — sous-plan 4a : logique du panel (seed export, client SSE, apply-to-store)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps en checkbox (`- [ ]`).

**Goal:** La logique testable qui relie le moteur backend à l'éditeur, **avant** l'UI (4b) :
1. **Seed** : exporter le pack courant en `menu/v1[]` (pour seeder la conversation backend).
2. **Client SSE** : ouvrir une conversation + streamer un message (fetch POST → events).
3. **Apply** : action `accountStore` qui applique un menu `menu/v1` généré via le convertisseur `menuV1ToDomain` (déjà construit) — insert dans le pack + merge i18n.

**Architecture:** Côté éditeur (`editor/`):
- `features/export/transform.ts` — exporter `serializeMenuToV1(menu, pack)` (extraire le `serializeMenu` privé) + `packToMenuV1(pack)`.
- `lib/api/assistant.ts` — `openConversation()` + `streamAssistant()` (async generator parsant le SSE depuis `response.body`).
- `state/accountStore.ts` — action `applyAssistantMenu({ packId, menuV1, lang })` (convertit + insert + merge i18n).

**Tech Stack:** TS, Vitest (`npm test` dans `editor/`), `yaml` (déjà dep), `menuV1ToDomain` (sub-plan 1), `validateMenuV1` (P1.0).

**Prérequis:** moteur backend (2a–2d) + convertisseur (sub-plan 1) mergés.

---

### Task 1 : `serializeMenuToV1` + `packToMenuV1` (export public) — TDD

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Create: `editor/src/features/export/menuV1.test.ts`

- [ ] **Step 1 : Test (RED)** :
```ts
import { describe, expect, it } from "vitest";
import { menuId, packId, layerId, elementId } from "@/domain/ids";
import type { I18nKey, Pack } from "@/domain/types";
import { validateMenuV1 } from "@/schema/validateMenuV1";
import { packToMenuV1, serializeMenuToV1 } from "./transform";

function pack(): Pack {
  return {
    id: packId("p"), name: "P", source: "user_created", createdAt: "", updatedAt: "",
    defaultLang: "en", i18nKeys: { "k": { en: "Shop" } } as Pack["i18nKeys"],
    menus: [{
      id: menuId("shop"), packId: packId("p"), rows: 3,
      title: [{ kind: "plain", value: { key: "k" as I18nKey } }],
      layers: [{ id: layerId("l1"), name: "default", elements: [
        { id: elementId("e1"), positions: "0", appearances: [{ material: "STONE" }] },
      ] }],
    }],
    commands: [], dialogs: [], assets: [], templates: [], dataSources: [], importedConnectors: [], canvasLayout: {},
  } as Pack;
}

describe("serializeMenuToV1 / packToMenuV1", () => {
  it("produces a canonical menu/v1 object that validates", () => {
    const p = pack();
    const m = serializeMenuToV1(p.menus[0], p);
    expect(m.schema).toBe("menu/v1");
    expect(m.size).toBe(27);
    expect(validateMenuV1(m)).toEqual({ valid: true, errors: [] });
  });
  it("packToMenuV1 returns one object per menu", () => {
    const p = pack();
    const arr = packToMenuV1(p);
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe("shop");
  });
});
```

- [ ] **Step 2 : Run (FAIL)** — `npx vitest run src/features/export/menuV1.test.ts` (working_directory `editor`).

- [ ] **Step 3 : Implémenter** — dans `transform.ts`, **exporter** la sérialisation menu (le corps actuel de `serializeMenu` privé) :
  - Renommer/exposer : `export function serializeMenuToV1(menu: Menu, pack: Pack): Record<string, unknown> { /* corps existant de serializeMenu */ }`, et faire pointer l'usage interne (`transform()`) dessus.
  - Ajouter : `export function packToMenuV1(pack: Pack): Record<string, unknown>[] { return pack.menus.map((m) => serializeMenuToV1(m, pack)); }` (avec un cast `as any`/typage local pour `.id` dans le test, ou typer le retour `{ id: string } & Record<string, unknown>`).

- [ ] **Step 4 : Run (PASS)** — y compris `npx vitest run src/features/export` (les tests d'export existants restent verts). Commit `feat(export): public serializeMenuToV1 + packToMenuV1`.

---

### Task 2 : client SSE `lib/api/assistant.ts` — TDD

**Files:**
- Create: `editor/src/lib/api/assistant.ts`
- Create: `editor/src/lib/api/assistant.test.ts`

- [ ] **Step 1 : Implémenter** :
```ts
export interface AssistantEvent { type: string; [k: string]: unknown }

function apiUrl(): string {
  return (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";
}
function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function openConversation(
  token: string,
  body: { menus: unknown[]; attachments?: Record<string, string> },
): Promise<string> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations`, {
    method: "POST", headers: authHeaders(token), body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openConversation failed: ${res.status}`);
  const json = (await res.json()) as { conversationId: string };
  return json.conversationId;
}

/** Stream EngineEvents from a message. Parses SSE frames from the POST response body. */
export async function* streamAssistant(
  token: string,
  conversationId: string,
  body: { text: string; menus?: unknown[]; attachments?: Record<string, string> },
): AsyncGenerator<AssistantEvent> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations/${conversationId}/messages`, {
    method: "POST", headers: authHeaders(token), body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`streamAssistant failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      // SSE frames are separated by a blank line.
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const ev = parseFrame(frame);
        if (ev) yield ev;
      }
    }
    const last = parseFrame(buf);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): AssistantEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    return { type: event, ...payload };
  } catch {
    return { type: event, raw: dataLines.join("\n") };
  }
}
```

- [ ] **Step 2 : Test** — mocker `fetch` (vi.stubGlobal) :
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { openConversation, streamAssistant } from "./assistant";

function sseResponse(frames: string[]): Response {
  const text = frames.map((f) => `${f}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); },
  });
  return new Response(stream, { status: 200 });
}
afterEach(() => vi.unstubAllGlobals());

describe("assistant SSE client", () => {
  it("openConversation returns the id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ conversationId: "c1" }), { status: 200 })));
    expect(await openConversation("t", { menus: [] })).toBe("c1");
  });
  it("streamAssistant yields parsed events across frames", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      'event: text\ndata: {"text":"Hi"}',
      'event: menu_written\ndata: {"menu":{"id":"shop"}}',
      'event: done\ndata: {"stopReason":"end_turn"}',
    ])));
    const events: any[] = [];
    for await (const e of streamAssistant("t", "c1", { text: "x" })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["text", "menu_written", "done"]);
    expect(events[1].menu).toEqual({ id: "shop" });
  });
});
```

- [ ] **Step 3 : Run (PASS) + commit** `feat(api): assistant SSE client (openConversation + streamAssistant)`.

---

### Task 3 : action `applyAssistantMenu` (accountStore) — TDD

**Files:**
- Modify: `editor/src/state/accountStore.ts`
- Create: `editor/src/state/applyAssistantMenu.test.ts`

- [ ] **Step 1 : Ajouter à l'interface + impl** — dans `AccountState`, déclarer :
```ts
  /** Apply an AI-generated menu/v1: convert to domain, insert/replace in the pack, merge i18n. */
  applyAssistantMenu: (input: { packId: PackId; menuV1: Record<string, unknown>; lang: string }) => void;
```
Impl (dans le `create(...)`), réutilisant le convertisseur :
```ts
        applyAssistantMenu: ({ packId: pId, menuV1, lang }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const { menu, i18nKeys } = menuV1ToDomain(menuV1, { packId: pId, lang });
              menu.packId = pId;
              for (const [key, langs] of Object.entries(i18nKeys)) {
                pack.i18nKeys[key as I18nKey] = { ...(pack.i18nKeys[key as I18nKey] ?? {}), ...langs };
              }
              const idx = pack.menus.findIndex((m) => m.id === menu.id);
              if (idx >= 0) pack.menus[idx] = menu;
              else pack.menus.push(menu);
              pack.updatedAt = new Date().toISOString();
            }),
          ),
```
Importer `menuV1ToDomain` depuis `@/schema/menuV1ToDomain` en tête de fichier.

- [ ] **Step 2 : Test** :
```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useAccountStore } from "./accountStore";
import { getText } from "@/lib/i18n";
import { packId } from "@/domain/ids";

const menuV1 = {
  schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "menus.shop.title" } }], size: 27,
  layers: [{ id: "l1", name: "default", elements: [
    { id: "e1", positions: "13", appearances: [{ material: "DIAMOND", title: "<gold>Buy</gold>" }] },
  ] }],
};

describe("applyAssistantMenu", () => {
  beforeEach(() => {
    useAccountStore.getState().setAccount({ id: "a" as any, packs: [], packOrder: [] });
    useAccountStore.getState().createPack({ id: "p" });
  });
  it("imports the generated menu and merges i18n (literal text becomes resolvable)", () => {
    useAccountStore.getState().applyAssistantMenu({ packId: packId("p"), menuV1, lang: "en" });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId("p"))!;
    const menu = pack.menus.find((m) => m.id === "shop")!;
    expect(menu).toBeTruthy();
    const app = menu.layers[0].elements[0].appearances[0];
    expect(getText(pack, app.title, "en")).toBe("<gold>Buy</gold>");
  });
  it("replaces an existing menu with the same id", () => {
    useAccountStore.getState().applyAssistantMenu({ packId: packId("p"), menuV1, lang: "en" });
    useAccountStore.getState().applyAssistantMenu({ packId: packId("p"), menuV1: { ...menuV1, size: 54 }, lang: "en" });
    const pack = useAccountStore.getState().account.packs.find((p) => p.id === packId("p"))!;
    expect(pack.menus.filter((m) => m.id === "shop")).toHaveLength(1);
    expect(pack.menus.find((m) => m.id === "shop")!.rows).toBe(6);
  });
});
```

- [ ] **Step 3 : Run (PASS) + commit** `feat(store): applyAssistantMenu (import generated menu/v1 via converter)`.

---

### Task 4 : Docs

- [ ] **Step 1** — `CHANGELOG.md` `[Unreleased]` : seed export `serializeMenuToV1`/`packToMenuV1` ; client SSE assistant ; action `applyAssistantMenu`. `docs/architecture/editor-internals.md` : note « pipeline d'application IA : SSE → `menuV1ToDomain` → `applyAssistantMenu` ».
- [ ] **Step 2** — commit `docs(assistant): panel 4a — seed/SSE/apply logic`.

---

## Self-review

- **Seed** : `packToMenuV1` produit des objets `menu/v1` qui **valident** (test ajv) → cohérent avec le contrat backend. ✓
- **SSE** : parseur de frames robuste (buffer, split `\n\n`), testé sans réseau (fetch mocké + ReadableStream). ✓
- **Apply** : réutilise le convertisseur (sub-plan 1) ; insert/replace par id + merge i18n ; undoable via zundo (capture auto du `produce`). ✓
- **menu_deleted** : pas de nouvelle action — l'UI (4b) appellera `deleteFromPack({ packId, nodeIds:[id] })` (existant). ✓
- Logique découplée de l'UI → 4b assemble (Sheet + composer + file-drop + boucle SSE).

## Suite (4b — UI)

- `uiStore` flag `assistantPanelOpen` + bouton dans `WorkspaceTopBarControls`.
- `AssistantPanel` (Sheet `side="right"`, mobile-sheet) : transcript, composer + drag-drop fichiers, boucle `streamAssistant` → rend `text`, applique `menu_written` (`applyAssistantMenu`) / `menu_deleted`, cartes « menu créé/modifié », état « plus de crédits » (placeholder).
- `editor/src/modules/assistant/index.ts` `FrontendModule` + `registerModule` dans `main.tsx`.
- i18n `assistant.*` dans `locales/{en,fr}.ts`.
- Seed à l'ouverture : `openConversation(token, { menus: packToMenuV1(pack), attachments })`.
- (Réversibilité : checkpoint commit avant 1er write = raffinement ultérieur ; l'undo zundo couvre le cas de base.)
