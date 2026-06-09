# Feature IA — sous-plan 2a : abstraction `LLMProvider` (OpenAI-compatible, multi-provider)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps en checkbox (`- [ ]`).

**Goal:** Une abstraction provider neutre côté backend permettant de **choisir le LLM par configuration** (OpenAI, DeepSeek, Mistral, OpenRouter, Ollama local…) sans toucher le code. Un seul adaptateur `OpenAICompatibleProvider` (SDK `openai`) configuré par `baseURL`+`model`+`apiKey`, + un resolver de presets depuis l'env. Streaming + tool-calling normalisés en `LlmStreamEvent`.

**Architecture:** `backend/src/modules/assistant/provider/` : `types.ts` (interface neutre), `openaiCompatible.ts` (adaptateur, client `openai` injectable pour les tests), `config.ts` (presets + `resolveProviderConfig(env)` + `createProvider`). La boucle agentique / tools / grounding (sous-plans 2b+) vivent **au-dessus** de cette interface. **Pas d'Anthropic SDK** (multi-provider via le protocole OpenAI-compatible).

**Tech Stack:** Bun + TypeScript, SDK `openai`, Vitest via `bun run test` (wrapper `scripts/test.ts`).

> ⚠️ **JAMAIS `bun test` direct** — toujours `bun run test [chemin]` (le wrapper redirige `DATABASE_URL` vers `artisan_test` ; `bun test` direct wipe la DB dev — incident réel). Ces tests provider ne touchent pas la DB, mais respecter la règle.

**Prérequis:** P1 + convertisseur mergés (déjà fait).

---

### Task 1 : types + config (presets, resolver) — TDD

**Files:**
- Create: `backend/src/modules/assistant/provider/types.ts`
- Create: `backend/src/modules/assistant/provider/config.ts`
- Create: `backend/src/modules/assistant/provider/config.test.ts`
- Modify: `backend/package.json` (dep `openai`)

- [ ] **Step 1 : Ajouter la dépendance**

Run (working_directory `backend`): `bun add openai`

- [ ] **Step 2 : Écrire `types.ts`**

```ts
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "usage"; usage: LlmUsage }
  | { type: "done"; stopReason: string };

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: { id: string; name: string; arguments: string }[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema des paramètres. */
  parameters: Record<string, unknown>;
}

export interface LlmProvider {
  /** Un tour : messages (le 1er est généralement le system) + tools → flux d'events.
   *  Le caller exécute les tools et renvoie les résultats (role "tool") au tour suivant. */
  streamTurn(args: { messages: LlmMessage[]; tools: ToolDef[]; model: string }): AsyncIterable<LlmStreamEvent>;
}
```

- [ ] **Step 3 : Écrire le test (RED)** — `config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { resolveProviderConfig } from "./config";

describe("resolveProviderConfig", () => {
  it("returns null when no api key and not a local base url (feature disabled)", () => {
    expect(resolveProviderConfig({})).toBeNull();
  });

  it("resolves the openai preset by default", () => {
    const c = resolveProviderConfig({ ASSISTANT_API_KEY: "k" })!;
    expect(c.baseURL).toBe("https://api.openai.com/v1");
    expect(c.model).toBe("gpt-4.1-mini");
    expect(c.apiKey).toBe("k");
  });

  it("resolves the deepseek preset", () => {
    const c = resolveProviderConfig({ ASSISTANT_API_KEY: "k", ASSISTANT_PROVIDER: "deepseek" })!;
    expect(c.baseURL).toBe("https://api.deepseek.com/v1");
    expect(c.model).toBe("deepseek-chat");
  });

  it("honours explicit base url + model overrides", () => {
    const c = resolveProviderConfig({
      ASSISTANT_API_KEY: "k",
      ASSISTANT_PROVIDER: "mistral",
      ASSISTANT_BASE_URL: "https://example.test/v1",
      ASSISTANT_MODEL: "custom-model",
    })!;
    expect(c.baseURL).toBe("https://example.test/v1");
    expect(c.model).toBe("custom-model");
  });

  it("allows a local base url without an api key", () => {
    const c = resolveProviderConfig({ ASSISTANT_PROVIDER: "local" })!;
    expect(c.baseURL).toBe("http://localhost:11434/v1");
    expect(c.apiKey).toBe(""); // local servers often need no key
  });

  it("falls back to openai preset for an unknown provider name", () => {
    const c = resolveProviderConfig({ ASSISTANT_API_KEY: "k", ASSISTANT_PROVIDER: "bogus" })!;
    expect(c.baseURL).toBe("https://api.openai.com/v1");
  });
});
```

- [ ] **Step 4 : Run (FAIL)**

Run (working_directory `backend`): `bun run test src/modules/assistant/provider/config.test.ts`
Expected : FAIL (`config.ts` absent).

- [ ] **Step 5 : Écrire `config.ts`**

```ts
import type { LlmProvider } from "./types";
import { OpenAICompatibleProvider } from "./openaiCompatible";

interface Preset { baseURL: string; defaultModel: string }

const PRESETS: Record<string, Preset> = {
  openai:     { baseURL: "https://api.openai.com/v1",   defaultModel: "gpt-4.1-mini" },
  deepseek:   { baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  mistral:    { baseURL: "https://api.mistral.ai/v1",   defaultModel: "mistral-large-latest" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4.1-mini" },
  local:      { baseURL: "http://localhost:11434/v1",   defaultModel: "llama3.1" },
};

export interface ProviderConfig { baseURL: string; model: string; apiKey: string }

type Env = Record<string, string | undefined>;

/** Resolve the active provider from env, or null when the feature is disabled (no key + not local). */
export function resolveProviderConfig(env: Env): ProviderConfig | null {
  const preset = PRESETS[env.ASSISTANT_PROVIDER ?? "openai"] ?? PRESETS.openai;
  const baseURL = env.ASSISTANT_BASE_URL || preset.baseURL;
  const apiKey = env.ASSISTANT_API_KEY ?? "";
  const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
  if (!apiKey && !isLocal) return null;
  const model = env.ASSISTANT_MODEL || preset.defaultModel;
  return { baseURL, model, apiKey };
}

export function createProvider(cfg: ProviderConfig): LlmProvider {
  return new OpenAICompatibleProvider(cfg);
}
```

- [ ] **Step 6 : Stub `openaiCompatible.ts` (pour que config compile)** — créer le fichier avec la classe vide (corps en Task 2) :

```ts
import OpenAI from "openai";
import type { LlmMessage, LlmProvider, LlmStreamEvent, ToolDef } from "./types";
import type { ProviderConfig } from "./config";

type OpenAIClient = Pick<OpenAI, "chat">;

export class OpenAICompatibleProvider implements LlmProvider {
  private client: OpenAIClient;
  private cfg: ProviderConfig;
  constructor(cfg: ProviderConfig, client?: OpenAIClient) {
    this.cfg = cfg;
    this.client = client ?? new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey || "x" });
  }
  // eslint-disable-next-line require-yield
  async *streamTurn(_args: { messages: LlmMessage[]; tools: ToolDef[]; model: string }): AsyncIterable<LlmStreamEvent> {
    throw new Error("not implemented (Task 2)");
  }
}
```

- [ ] **Step 7 : Run (PASS)**

Run (working_directory `backend`): `bun run test src/modules/assistant/provider/config.test.ts`
Expected : PASS (6 tests).

- [ ] **Step 8 : Commit**

```bash
git add backend/package.json backend/bun.lock backend/src/modules/assistant/provider/types.ts backend/src/modules/assistant/provider/config.ts backend/src/modules/assistant/provider/config.test.ts backend/src/modules/assistant/provider/openaiCompatible.ts
git commit -m "feat(assistant): LLMProvider types + OpenAI-compatible config/presets"
```
(Adapter le nom du lockfile si c'est `bun.lockb`.)

---

### Task 2 : `OpenAICompatibleProvider.streamTurn` (mapping + stream normalization) — TDD

**Files:**
- Modify: `backend/src/modules/assistant/provider/openaiCompatible.ts`
- Create: `backend/src/modules/assistant/provider/openaiCompatible.test.ts`

- [ ] **Step 1 : Test (RED)** — client `openai` factice qui renvoie un async-iterable de chunks scriptés (text + un tool_call dont les `arguments` sont streamés en 2 fragments + usage final).

```ts
import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import type { LlmStreamEvent } from "./types";

function fakeStream(chunks: any[]) {
  return (async function* () { for (const c of chunks) yield c; })();
}
function fakeClient(chunks: any[]) {
  return { chat: { completions: { create: async () => fakeStream(chunks) } } } as any;
}
async function collect(it: AsyncIterable<LlmStreamEvent>) {
  const out: LlmStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const cfg = { baseURL: "x", model: "m", apiKey: "k" };

describe("OpenAICompatibleProvider.streamTurn", () => {
  it("emits text deltas, then accumulates a tool_use, usage and done", async () => {
    const chunks = [
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "upsert_menu", arguments: '{"id":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"shop"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 12, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 4 } } },
    ];
    const p = new OpenAICompatibleProvider(cfg, fakeClient(chunks));
    const events = await collect(p.streamTurn({ messages: [{ role: "user", content: "hi" }], tools: [], model: "m" }));

    const text = events.filter((e) => e.type === "text").map((e: any) => e.text).join("");
    expect(text).toBe("Hello");

    const toolUse = events.find((e) => e.type === "tool_use") as any;
    expect(toolUse).toMatchObject({ id: "call_1", name: "upsert_menu" });
    expect(toolUse.input).toEqual({ id: "shop" });

    const usage = events.find((e) => e.type === "usage") as any;
    expect(usage.usage).toEqual({ inputTokens: 12, outputTokens: 7, cachedInputTokens: 4 });

    const done = events.find((e) => e.type === "done") as any;
    expect(done.stopReason).toBe("tool_calls");
  });

  it("passes mapped messages + tools to the client", async () => {
    let received: any;
    const client = { chat: { completions: { create: async (params: any) => { received = params; return fakeStream([{ choices: [{ delta: {}, finish_reason: "stop" }] }]); } } } } as any;
    const p = new OpenAICompatibleProvider(cfg, client);
    await collect(p.streamTurn({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "u" },
        { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "get_menu", arguments: "{}" }] },
        { role: "tool", toolCallId: "c1", content: "result" },
      ],
      tools: [{ name: "get_menu", description: "d", parameters: { type: "object", properties: {} } }],
      model: "m",
    }));
    expect(received.model).toBe("m");
    expect(received.stream).toBe(true);
    expect(received.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(received.messages[2]).toEqual({ role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_menu", arguments: "{}" } }] });
    expect(received.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "result" });
    expect(received.tools[0]).toEqual({ type: "function", function: { name: "get_menu", description: "d", parameters: { type: "object", properties: {} } } });
  });
});
```

- [ ] **Step 2 : Run (FAIL)** — `bun run test src/modules/assistant/provider/openaiCompatible.test.ts`.

- [ ] **Step 3 : Implémenter `streamTurn`** (remplacer le corps stub) :

```ts
async *streamTurn(args: { messages: LlmMessage[]; tools: ToolDef[]; model: string }): AsyncIterable<LlmStreamEvent> {
  const messages = args.messages.map((m) => {
    switch (m.role) {
      case "system": return { role: "system", content: m.content };
      case "user": return { role: "user", content: m.content };
      case "tool": return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
      case "assistant": return {
        role: "assistant",
        content: m.content,
        ...(m.toolCalls && m.toolCalls.length > 0
          ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.arguments } })) }
          : {}),
      };
    }
  });

  const tools = args.tools.length > 0
    ? args.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))
    : undefined;

  const stream = await this.client.chat.completions.create({
    model: args.model,
    messages: messages as never,
    tools: tools as never,
    stream: true,
    stream_options: { include_usage: true },
  } as never);

  const acc = new Map<number, { id: string; name: string; args: string }>();
  let usage: { type: "usage"; usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } } | null = null;
  let stopReason = "stop";

  for await (const chunk of stream as AsyncIterable<any>) {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) yield { type: "text", text: delta.content };
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const cur = acc.get(tc.index) ?? { id: "", name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        acc.set(tc.index, cur);
      }
    }
    if (choice?.finish_reason) stopReason = choice.finish_reason;
    if (chunk.usage) {
      usage = {
        type: "usage",
        usage: {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
          ...(chunk.usage.prompt_tokens_details?.cached_tokens !== undefined
            ? { cachedInputTokens: chunk.usage.prompt_tokens_details.cached_tokens }
            : {}),
        },
      };
    }
  }

  if (usage) yield usage;
  for (const tc of [...acc.values()].filter((t) => t.id)) {
    let input: unknown = {};
    try { input = tc.args ? JSON.parse(tc.args) : {}; } catch { input = { __raw: tc.args }; }
    yield { type: "tool_use", id: tc.id, name: tc.name, input };
  }
  yield { type: "done", stopReason };
}
```
(Les `as never` neutralisent les types stricts du SDK `openai` pour le mapping dynamique ; respecter la convention lint du repo — utiliser des `// biome-ignore` si `noExplicitAny` bloque, comme ailleurs dans le backend.)

- [ ] **Step 4 : Run (PASS)** — `bun run test src/modules/assistant/provider/openaiCompatible.test.ts` → 2 tests.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/modules/assistant/provider/openaiCompatible.ts backend/src/modules/assistant/provider/openaiCompatible.test.ts
git commit -m "feat(assistant): OpenAICompatibleProvider streamTurn (stream + tool-call normalization)"
```

---

### Task 3 : smoke réel (gated) + docs

**Files:**
- Create: `backend/src/modules/assistant/provider/smoke.test.ts`
- Modify: `.env.example`, `CHANGELOG.md`

- [ ] **Step 1 : Test smoke gated** (skip sauf `ASSISTANT_SMOKE=1` + clé) :

```ts
import { describe, expect, it } from "vitest";
import { resolveProviderConfig, createProvider } from "./config";

const run = process.env.ASSISTANT_SMOKE === "1";
describe.skipIf(!run)("provider smoke (real network)", () => {
  it("streams a tool call from the configured provider", async () => {
    const cfg = resolveProviderConfig(process.env)!;
    const provider = createProvider(cfg);
    const events: any[] = [];
    for await (const e of provider.streamTurn({
      messages: [{ role: "user", content: "Call the tool ping with {\"x\":1}." }],
      tools: [{ name: "ping", description: "Ping with a number", parameters: { type: "object", properties: { x: { type: "number" } }, required: ["x"] } }],
      model: cfg.model,
    })) events.push(e);
    expect(events.some((e) => e.type === "tool_use")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
```

- [ ] **Step 2 : Run (skipped par défaut)** — `bun run test src/modules/assistant/provider/smoke.test.ts` → 0 run / skipped. (Pour tester réellement : `ASSISTANT_SMOKE=1 ASSISTANT_PROVIDER=... ASSISTANT_API_KEY=... ASSISTANT_MODEL=... bun run test ...`.)

- [ ] **Step 3 : Docs** — `.env.example` : ajouter `ASSISTANT_PROVIDER` / `ASSISTANT_BASE_URL` / `ASSISTANT_API_KEY` / `ASSISTANT_MODEL` (commentés, avec exemples openai/deepseek/mistral/local). `CHANGELOG.md` `[Unreleased]` : abstraction `LLMProvider` OpenAI-compatible (multi-provider par config) + adaptateur streaming/tool-calling.

- [ ] **Step 4 : Commit**

```bash
git add backend/src/modules/assistant/provider/smoke.test.ts .env.example CHANGELOG.md
git commit -m "test(assistant): gated provider smoke + docs (.env.example, changelog)"
```

---

## Self-review

- **Multi-provider par config** : preset (openai/deepseek/mistral/openrouter/local) + override `baseURL`/`model` ; un seul adaptateur ; aucun code à changer pour switcher. ✓
- **Testable sans réseau** : client `openai` injectable ; chunks scriptés couvrent text + tool_call streamé en fragments + usage. Smoke réel gated. ✓
- **Feature disabled sans clé** (sauf local) → `resolveProviderConfig` renvoie `null`. ✓
- **Neutre** : `streamTurn` ne sait rien des menus/tools métier — la boucle/gate/grounding sont au-dessus (2b+). ✓
- **`bun run test` uniquement** (jamais `bun test`). ✓

## Suite (moteur IA)

- **2b — tools + boucle agentique** : working-copy `menu/v1`, tools (`list_menus`/`get_menu`/`upsert_menu` gate=`validateMenuV1`/`delete_menu`/`read_attachment`), boucle manuelle (exécute tools → renvoie role "tool" → re-`streamTurn`), cap itérations.
- **2c — grounding** : `menu-v1-authoring-guide.md` (+ vocab domain), `zmenu-reference.md`, `deluxemenus-reference.md` ; assemblés en 1er message system.
- **2d — endpoints SSE + état conversation** : `POST /api/v1/assistant/conversations|messages`, stream SSE, working-copy en mémoire.
- Puis sous-plan 3 (crédits) + 4 (panel éditeur).
