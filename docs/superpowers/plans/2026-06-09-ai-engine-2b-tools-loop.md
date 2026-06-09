# Feature IA — sous-plan 2b : tools + boucle agentique (backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps en checkbox (`- [ ]`).

**Goal:** Au-dessus du `LLMProvider` (2a), construire le cœur agentique : un **gate de validation** `menu/v1` côté backend, une **working-copy** du pack en `menu/v1` (en mémoire), les **tools** que l'IA appelle (`list_menus`/`get_menu`/`upsert_menu`/`delete_menu`/`read_attachment`), et la **boucle manuelle** (streamTurn → exécuter les tools → renvoyer les résultats role "tool" → re-streamTurn, jusqu'à fin ou cap). Le tout émet des **EngineEvent** de haut niveau (consommés par l'endpoint SSE en 2d). Testable avec un provider mocké scripté.

**Architecture:** `backend/src/modules/assistant/`:
- `validate.ts` — `validateMenuV1(menu)` = `ajv(docs/schema/menu/v1/schema.json)` + `validateMenuLayout` (importé de `docs/schema/menu/v1/types.ts`). **Même contrat que l'éditeur.**
- `workingCopy.ts` — état en mémoire : `Map<menuId, MenuV1>` + attachments `Map<fileId, string>`.
- `tools.ts` — `TOOL_DEFS: ToolDef[]` + `executeTool(name, input, wc) → ToolResult`.
- `loop.ts` — `runTurn(provider, model, messages, wc, opts) : AsyncIterable<EngineEvent>`.

**Tech Stack:** Bun + TS, `ajv` + `ajv-formats`, `bun run test`.

> ⚠️ **JAMAIS `bun test` direct** — toujours `bun run test [chemin]` (wrapper `scripts/test.ts` ; `bun test` direct wipe la DB dev). Ces tests ne touchent pas la DB mais respecter la règle.

**Prérequis:** 2a mergée (provider). Imports cross-repo vers `docs/schema/menu/v1/` (Bun importe JSON + TS nativement au runtime).

---

### Task 1 : gate `validateMenuV1` (backend) — TDD

**Files:**
- Create: `backend/src/modules/assistant/validate.ts`
- Create: `backend/src/modules/assistant/validate.test.ts`
- Modify: `backend/package.json` (deps `ajv`, `ajv-formats`)

- [ ] **Step 1 :** `bun add ajv ajv-formats` (working_directory `backend`).

- [ ] **Step 2 : Test (RED)** — `validate.test.ts` :
```ts
import { describe, expect, it } from "bun:test";
import { validateMenuV1 } from "./validate";

const good = {
  schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27,
  layers: [{ id: "l1", name: "default", elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }] }],
};

describe("validateMenuV1 (backend gate)", () => {
  it("accepts a canonical menu", () => {
    expect(validateMenuV1(good)).toEqual({ valid: true, errors: [] });
  });
  it("rejects a bad size (ajv)", () => {
    const r = validateMenuV1({ ...good, size: 13 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/size/);
  });
  it("rejects duplicate element ids (validateMenuLayout)", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [
        { id: "dup", positions: "0", appearances: [{ material: "STONE" }] },
        { id: "dup", positions: "1", appearances: [{ material: "STONE" }] },
      ] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/dup/);
  });
  it("rejects an out-of-bounds position (validateMenuLayout)", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "99", appearances: [{ material: "STONE" }] }] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/bounds|out of/i);
  });
});
```

- [ ] **Step 3 : Run (FAIL)** — `bun run test src/modules/assistant/validate.test.ts`.

- [ ] **Step 4 : Implémenter `validate.ts`** :
```ts
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../../../docs/schema/menu/v1/schema.json";
import { validateMenuLayout } from "../../../../docs/schema/menu/v1/types";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateStruct = ajv.compile(schema);

export interface MenuV1ValidationResult { valid: boolean; errors: string[] }

/** Gate identique à l'éditeur : structure (ajv) + cross-field (validateMenuLayout). */
export function validateMenuV1(menu: unknown): MenuV1ValidationResult {
  const ok = validateStruct(menu) as boolean;
  const structErrors = (validateStruct.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  let layoutErrors: string[] = [];
  if (ok) {
    // validateMenuLayout reads size/layers/context_inputs of a menu/v1 object.
    layoutErrors = validateMenuLayout(menu as never).errors;
  }
  const errors = [...structErrors, ...layoutErrors];
  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 5 : Run (PASS)** — si l'import `../../../../docs/...` échoue (résolution Bun), ajuster la profondeur relative (vérifier le chemin réel depuis `backend/src/modules/assistant/`) ; confirmer que Bun importe bien le `.json` (sinon `Bun.file(...).json()` au module-load, mais l'import statique doit marcher). Tests verts.

- [ ] **Step 6 : Commit**
```bash
git add backend/package.json backend/bun.lock backend/src/modules/assistant/validate.ts backend/src/modules/assistant/validate.test.ts
git commit -m "feat(assistant): backend menu/v1 validation gate (ajv + validateMenuLayout)"
```

---

### Task 2 : working-copy + tools — TDD

**Files:**
- Create: `backend/src/modules/assistant/workingCopy.ts`
- Create: `backend/src/modules/assistant/tools.ts`
- Create: `backend/src/modules/assistant/tools.test.ts`

- [ ] **Step 1 : `workingCopy.ts`** :
```ts
export type MenuV1 = Record<string, any>; // wire menu/v1 object

export class WorkingCopy {
  private menus = new Map<string, MenuV1>();
  private attachments = new Map<string, string>();

  constructor(menus: MenuV1[] = [], attachments: Record<string, string> = {}) {
    for (const m of menus) if (typeof m?.id === "string") this.menus.set(m.id, m);
    for (const [k, v] of Object.entries(attachments)) this.attachments.set(k, v);
  }
  list(): { id: string; title: unknown; size: number }[] {
    return [...this.menus.values()].map((m) => ({ id: m.id, title: m.title, size: m.size }));
  }
  get(id: string): MenuV1 | undefined { return this.menus.get(id); }
  upsert(menu: MenuV1): void { this.menus.set(menu.id, menu); }
  delete(id: string): boolean { return this.menus.delete(id); }
  attachment(fileId: string): string | undefined { return this.attachments.get(fileId); }
  snapshot(): MenuV1[] { return [...this.menus.values()]; }
}
```

- [ ] **Step 2 : Test (RED)** — `tools.test.ts` couvre : `TOOL_DEFS` contient les 5 tools avec un `parameters` JSON-Schema ; `executeTool("upsert_menu", invalidMenu)` → `{ok:false}` avec erreurs (gate) et pas d'écriture ; `upsert_menu(validMenu)` → `{ok:true, event:{type:"menu_written"}}` + présent dans `wc.get` ; `get_menu`/`list_menus`/`delete_menu`/`read_attachment`.

- [ ] **Step 3 : `tools.ts`** :
```ts
import type { ToolDef } from "./provider/types";
import { validateMenuV1 } from "./validate";
import type { WorkingCopy, MenuV1 } from "./workingCopy";

export type EngineEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; ok: boolean; detail?: string }
  | { type: "menu_written"; menu: MenuV1 }
  | { type: "menu_deleted"; id: string }
  | { type: "usage"; usage: import("./provider/types").LlmUsage }
  | { type: "error"; message: string }
  | { type: "done"; stopReason: string };

export interface ToolResult { ok: boolean; content: string; event?: EngineEvent }

export const TOOL_DEFS: ToolDef[] = [
  { name: "list_menus", description: "List menus in the current pack (id, title, size).", parameters: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_menu", description: "Get a menu's full canonical menu/v1 JSON by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "upsert_menu", description: "Create or replace a menu. The argument is a complete canonical menu/v1 object. Rejected with errors if invalid — fix and retry.", parameters: { type: "object", properties: { menu: { type: "object" } }, required: ["menu"], additionalProperties: false } },
  { name: "delete_menu", description: "Delete a menu by id.", parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false } },
  { name: "read_attachment", description: "Read the raw text of a dropped zmenu/DeluxeMenus file by id.", parameters: { type: "object", properties: { file_id: { type: "string" } }, required: ["file_id"], additionalProperties: false } },
];

export function executeTool(name: string, input: any, wc: WorkingCopy): ToolResult {
  switch (name) {
    case "list_menus":
      return { ok: true, content: JSON.stringify(wc.list()) };
    case "get_menu": {
      const m = wc.get(String(input?.id));
      return m ? { ok: true, content: JSON.stringify(m) } : { ok: false, content: `No menu with id "${input?.id}".` };
    }
    case "upsert_menu": {
      const menu = input?.menu;
      const v = validateMenuV1(menu);
      if (!v.valid) return { ok: false, content: `Invalid menu/v1. Fix these and retry:\n- ${v.errors.join("\n- ")}` };
      wc.upsert(menu);
      return { ok: true, content: `Menu "${menu.id}" saved.`, event: { type: "menu_written", menu } };
    }
    case "delete_menu": {
      const id = String(input?.id);
      const existed = wc.delete(id);
      return existed
        ? { ok: true, content: `Menu "${id}" deleted.`, event: { type: "menu_deleted", id } }
        : { ok: false, content: `No menu with id "${id}".` };
    }
    case "read_attachment": {
      const txt = wc.attachment(String(input?.file_id));
      return txt !== undefined ? { ok: true, content: txt } : { ok: false, content: `No attachment "${input?.file_id}".` };
    }
    default:
      return { ok: false, content: `Unknown tool "${name}".` };
  }
}
```

- [ ] **Step 4 : Run (PASS) + commit** `feat(assistant): working-copy + tools (upsert gate, get/list/delete/read_attachment)`.

---

### Task 3 : boucle agentique `runTurn` — TDD (provider mocké)

**Files:**
- Create: `backend/src/modules/assistant/loop.ts`
- Create: `backend/src/modules/assistant/loop.test.ts`

- [ ] **Step 1 : `loop.ts`** :
```ts
import type { LlmMessage, LlmProvider } from "./provider/types";
import { TOOL_DEFS, executeTool, type EngineEvent } from "./tools";
import type { WorkingCopy } from "./workingCopy";

export async function* runTurn(args: {
  provider: LlmProvider;
  model: string;
  messages: LlmMessage[]; // mutated in place across iterations (system + history + this user msg)
  wc: WorkingCopy;
  maxIterations?: number;
}): AsyncIterable<EngineEvent> {
  const { provider, model, messages, wc } = args;
  const maxIterations = args.maxIterations ?? 25;

  for (let i = 0; i < maxIterations; i++) {
    let text = "";
    const toolCalls: { id: string; name: string; input: unknown }[] = [];
    let stop = "end_turn";

    for await (const ev of provider.streamTurn({ messages, tools: TOOL_DEFS, model })) {
      if (ev.type === "text") { text += ev.text; yield ev; }
      else if (ev.type === "tool_use") toolCalls.push({ id: ev.id, name: ev.name, input: ev.input });
      else if (ev.type === "usage") yield ev;
      else if (ev.type === "done") stop = ev.stopReason;
    }

    messages.push({
      role: "assistant",
      content: text || null,
      ...(toolCalls.length > 0
        ? { toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: JSON.stringify(tc.input) })) }
        : {}),
    });

    if (toolCalls.length === 0) { yield { type: "done", stopReason: stop }; return; }

    for (const tc of toolCalls) {
      const res = executeTool(tc.name, tc.input, wc);
      if (res.event) yield res.event;
      yield { type: "tool", name: tc.name, ok: res.ok, detail: res.ok ? undefined : res.content };
      messages.push({ role: "tool", toolCallId: tc.id, content: res.content });
    }
    // loop: re-streamTurn with the appended tool results
  }

  yield { type: "error", message: `Reached the ${maxIterations}-iteration cap.` };
  yield { type: "done", stopReason: "max_iterations" };
}
```

- [ ] **Step 2 : Test (RED)** — `loop.test.ts` avec un provider mocké scripté (une réponse par appel `streamTurn`) :
```ts
import { describe, expect, it } from "bun:test";
import { runTurn } from "./loop";
import { WorkingCopy } from "./workingCopy";
import type { LlmProvider, LlmStreamEvent } from "./provider/types";

function scriptedProvider(turns: LlmStreamEvent[][]): LlmProvider {
  let i = 0;
  return {
    async *streamTurn() {
      const t = turns[i++] ?? [{ type: "done", stopReason: "end_turn" }];
      for (const e of t) yield e;
    },
  };
}
const validMenu = {
  schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27,
  layers: [{ id: "l1", name: "default", elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }] }],
};
async function collect(it: AsyncIterable<any>) { const o: any[] = []; for await (const e of it) o.push(e); return o; }

describe("runTurn", () => {
  it("self-corrects after an invalid upsert, then writes the menu", async () => {
    const provider = scriptedProvider([
      // turn 1: invalid upsert (size 13)
      [{ type: "tool_use", id: "c1", name: "upsert_menu", input: { menu: { ...validMenu, size: 13 } } }, { type: "done", stopReason: "tool_calls" }],
      // turn 2: corrected upsert
      [{ type: "tool_use", id: "c2", name: "upsert_menu", input: { menu: validMenu } }, { type: "done", stopReason: "tool_calls" }],
      // turn 3: final text, no tools
      [{ type: "text", text: "Done." }, { type: "done", stopReason: "end_turn" }],
    ]);
    const wc = new WorkingCopy();
    const messages: any[] = [{ role: "user", content: "make a shop" }];
    const events = await collect(runTurn({ provider, model: "m", messages, wc }));

    const failTool = events.find((e) => e.type === "tool" && e.ok === false);
    expect(failTool).toBeTruthy();
    expect(events.some((e) => e.type === "menu_written")).toBe(true);
    expect(wc.get("shop")).toBeTruthy();
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
  });

  it("stops at the iteration cap if the model never stops calling tools", async () => {
    const loopTurn: LlmStreamEvent[] = [{ type: "tool_use", id: "x", name: "list_menus", input: {} }, { type: "done", stopReason: "tool_calls" }];
    const provider: LlmProvider = { async *streamTurn() { for (const e of loopTurn) yield e; } };
    const events = await collect(runTurn({ provider, model: "m", messages: [{ role: "user", content: "loop" }], wc: new WorkingCopy(), maxIterations: 3 }));
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "max_iterations" });
  });
});
```

- [ ] **Step 3 : Run (PASS) + commit** `feat(assistant): agentic loop (runTurn) with self-correction + iteration cap`.

---

### Task 4 : Docs

- [ ] **Step 1** — `CHANGELOG.md` `[Unreleased]` : gate `menu/v1` backend (ajv + validateMenuLayout) ; tools (`list/get/upsert/delete/read_attachment`) ; boucle agentique avec auto-correction + cap. `docs/architecture/modules.md` : ébauche section « Module assistant » (provider + gate + tools + loop ; SSE/endpoints en 2d).
- [ ] **Step 2** — commit `docs(assistant): engine 2b — tools + agentic loop`.

---

## Self-review

- **Gate = contrat éditeur** : ajv(schema.json) + validateMenuLayout → un menu invalide ne peut pas entrer dans la working-copy ; les erreurs reviennent au modèle (auto-correction). ✓
- **Au-dessus du provider** : `runTurn` ne dépend que de `LlmProvider` (mocké en test) — pas de réseau. ✓
- **EngineEvent** = surface consommée par le SSE (2d) et le métering (3, sur `usage`). ✓
- **Cap** : pas de boucle infinie. ✓
- **`bun run test` only.** ✓
- **Open items (2d/3)** : conversation/working-copy seeding + SSE ; débit crédits sur les events `usage` ; grounding (2c) = 1er message system.

## Suite

- **2c — grounding** : `menu-v1-authoring-guide.md` (+ vocab domain supporté), `zmenu-reference.md`, `deluxemenus-reference.md` → assemblés en message system de tête + contrainte de vocab.
- **2d — endpoints SSE + état conversation** : `POST /api/v1/assistant/conversations|messages`, map EngineEvent→SSE, working-copy en mémoire par conversation, auth editor-session.
- **3 — crédits** (débit sur `usage`). **4 — panel éditeur** (applique `menu_written`/`menu_deleted` via le convertisseur menu/v1→domain).
