# AI assistant — natural-language menu generation + zmenu/DeluxeMenus migration

**Status:** design approved — **UNBLOCKED** (P1 `menu/v1` canonicalization done: P1.0 schema + P1.1 editor + P1.2 plugin, merged). The contract emitted by the AI = **canonical** `menu/v1`; the gate = `ajv(menu/v1/schema.json)` (cf. `editor/src/schema/validateMenuV1.ts`) + cross-field checks. Sequential sub-plans: **(1) `menu/v1 → domain` converter** — reduced by P1 to the i18n bridge + un-snake + `size`/`rows` + `pagination_*`→`paginate` (plan `2026-06-08-ai-converter-menuv1-to-domain.md`); (2) backend engine; (3) credits; (4) editor panel. **Sub-plan (3) credits is delivered — extended into a full model system — by `2026-07-02-ai-model-system-design.md` (plans `2026-07-02-ai-models-1..4`).**
**Author:** brainstorm 2026-06-08
**Related code (to create):** `backend/src/modules/assistant/`, `editor/src/modules/assistant/`
**Related code (reused):** `docs/schema/menu/v1/{schema.json,types.ts}` (validation), the editor's domain→menu/v1 export pipeline, commits model (`pack_commits`, History/Restore tab), `editor/src/state/accountStore.ts`.

## Context

Today an admin builds their menus by hand in the web editor. Two frictions:

1. **Onboarding** — admins arrive with existing configs (zmenu, DeluxeMenus). Retyping them by hand is an entry wall.
2. **Velocity** — describing a menu in natural language and seeing it appear is faster than manual placement for common cases.

This spec covers a **long-term product feature**: a persistent AI assistant in the platform with **two entry points on a common engine** — (1) describe a menu in natural language, (2) drop a zmenu/DeluxeMenus file to convert. Immediate driver: migrate the author's production zmenu menus to validate the stack end to end.

## Brainstorm decisions

| Question | Choice |
|---|---|
| Intent | Long-term product feature (not a throwaway migration tool) |
| v1 entry-point scope | **Both** (NL + migration) on a common engine |
| Interaction shape | **Multi-turn chat, editing included** (the AI creates AND modifies existing menus) |
| Cost / key | **You provide the key** (provider not necessarily Anthropic); users spend **credits** |
| v1 billing scope | **Consumption only** (ledger + metering + debit + block at zero, manual grant for testing). Acquisition (Stripe/subscriptions) = separate project. |
| Engine | **A — Tool-use agent hosted by us** (Claude API + tool use, manual loop). Not Managed Agents. |

## Goals

- A single chat surface where the user **writes in natural language OR drops** zmenu/DeluxeMenus files.
- The AI **creates and modifies** menus of the current pack **reliably**: every menu produced is structurally valid (never a silently broken menu).
- **Reversible**: in-place editing is not scary (checkpoint commit + undo).
- **Provider-agnostic**: no hard dependency on Anthropic in the architecture.
- **Metered**: each operation consumes credits; clean block at zero.

## Non-goals (v1)

- Generation of **commands / dialogs / translations** (migration sources are menu plugins → cut to menus; later extension).
- **Credit acquisition** (Stripe payment, subscriptions, purchase) — separate project. V1 = manual/admin grant.
- Durable persistence of the chat **transcript** across reloads / backend restarts (conversation state is in server memory, re-seedable — cf. §4).
- Automatic creation of the **opening command** of a migrated menu (zmenu / DeluxeMenus `open_command`) — noted in the menu's `notes`, creation deferred.
- Multi-pack / multi-network in a single conversation (one conversation = one (network, pack)).
- Fine-grained concurrent editing (simple **last-writer** model; cf. §4).

## Architecture

New **`assistant`** module following the modular monolith pattern (`docs/architecture/modules.md`), **2 layers** (no plugin layer — it is editor ↔ backend):

- **Backend** `backend/src/modules/assistant/` — exports a `BackendModule`, registered in `app.ts` (`mountModules`). Contains: endpoints, engine (agentic loop), tools, grounding, `LLMProvider`, metering.
- **Editor** `editor/src/modules/assistant/` — exports a `FrontendModule`, `registerModule(...)` in `main.tsx`. Contains: chat panel, file-drop, SSE client, `menu/v1 → domain` converter, applying the writes.

```
[Editor chat panel]                                               [Backend assistant module]
   │ 1. open conversation (seed working-copy = pack in menu/v1)        │
   │    POST /api/v1/assistant/conversations                           │
   │ 2. POST .../conversations/:id/messages  (SSE)  ───────────────▶   ├─ LLMProvider (Claude default, swappable)
   │       { text, attachmentIds[] }                                   ├─ manual agentic loop (@anthropic-ai/sdk)
   ◀── SSE: text_delta · tool_use · menu_written(menu/v1) ·            ├─ tools on the working-copy (menu/v1 only)
   │        menu_deleted · credits · error · done                      ├─ gate: ajv(schema.json) + validateMenuLayout
   │ 3. imports menu/v1 → domain, applies to accountStore (undo)       ├─ credit ledger debit
   │ 4. checkpoint commit before 1st write (reversibility)             └─ grounding (cached system prefix)
```

### Structuring decision: the backend stays in `menu/v1`

The backend **never knows the editor's domain model**. All conversion lives client-side:

- **domain → menu/v1** (seeding the working-copy): *already exists* (the editor's export pipeline). Reused as is.
- **menu/v1 → domain** (applying the writes): **built** (sub-plan (1), 2026-06-09) — `editor/src/schema/menuV1ToDomain.ts` (placed in `schema/` next to `validateMenuV1.ts` because it is reusable outside the AI; the future assistant module imports it from there). Pure function `menuV1ToDomain(src, opts) → { menu, i18nKeys, unsupported }` — no pack mutation, returns the allocated i18n keys. Coverage: unit tests (`menuV1ToDomain.test.ts`) + domain↔menu/v1 round-trip oracle (`menuV1ToDomain.roundtrip.test.ts`). It is the biggest piece of deterministic code in the project, and it is reusable (importing `menu/v1` files in general). It does:
  - **i18n bridge**: a `menu/v1` text field is a `string` that is either a literal or an inline ref `{i18n:KEY}`. Literal case → **allocate a key**, store the literal under the active language in `pack.i18nKeys`, produce an `LText { key }`. `{i18n:KEY}` case → `LText { key: KEY }` + import the values from the accompanying `translations/v1` into `pack.i18nKeys`. (On the domain side the text is **always** an `LText`, never an inline literal.)
  - **structure**: builds step-trees from the flat `actions[]`, builds `MenuTitleLayer[]` from the `title`, converts `size` → `rows`.
- **AI side**: it emits **readable literal text** (MiniMessage + PAPI placeholders preserved); the converter handles the i18n keying. The AI never handles keys.
- **Validation** on the backend side: `ajv` against `docs/schema/menu/v1/schema.json` + `validateMenuLayout` (imported from `docs/schema/menu/v1/types.ts`, framework-agnostic TS). **Exactly the same validator as the editor** → guaranteed consistency.

Consequence: the server working-copy is a `menu/v1` object, the tools read/write `menu/v1`, validation runs on `menu/v1`. No converter on the server side.

## Engine (agentic loop)

### `LLMProvider` (provider abstraction)

Neutral interface, in `backend/src/modules/assistant/provider/`:

```ts
interface LlmUsage { inputTokens: number; outputTokens: number; cachedInputTokens?: number; }
type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "usage"; usage: LlmUsage }
  | { type: "done"; stopReason: string };

type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: { id: string; name: string; arguments: string }[] }
  | { role: "tool"; toolCallId: string; content: string };
interface ToolDef { name: string; description: string; parameters: object; } // JSON Schema of the params

interface LlmProvider {
  /** One turn: messages (system is the 1st message) + tools → event stream. The caller executes the tools and sends the tool results (role "tool") back on the next turn. */
  streamTurn(args: { messages: LlmMessage[]; tools: ToolDef[]; model: string }): AsyncIterable<LlmStreamEvent>;
}
```

- **Single `OpenAICompatibleProvider`** impl (`openai` SDK) — **decision 2026-06-09: provider-agnostic via the OpenAI-compatible protocol, not Anthropic-only.**
  - Configured by **`baseURL` + `model` + `apiKey`** → covers **OpenAI, DeepSeek, Mistral, OpenRouter, local Ollama…**. Preset selected by env (`ASSISTANT_PROVIDER`) or explicit override (`ASSISTANT_BASE_URL`/`ASSISTANT_MODEL`/`ASSISTANT_API_KEY`). **Changing provider = changing the config, not the code.**
  - Tool calling via OpenAI function-calling (`tools`/`tool_calls`); `stream:true` streaming with accumulation of the `tool_calls` deltas (`id`/`name`/`arguments`) → normalized into `LlmStreamEvent`.
  - Prompt caching: **transparent on the provider side** (OpenAI auto-cache, DeepSeek context cache) — no client config; `cachedInputTokens` reported in the usage if the provider supplies it.
  - Anthropic/Claude **not included** as a native adapter in v1 — reachable through its OpenAI-compat endpoint or OpenRouter if needed. (The `claude-api` skill therefore does not apply to this engine.)
- The interface stays neutral: any native adapter (Anthropic, Google…) slots in later without touching the loop/tools/grounding.

### Tools (executed server-side, on the `menu/v1` working-copy)

| Tool | Effect |
|---|---|
| `list_menus()` | `[{ id, title, size, summary }]` — compact view (the AI fetches the detail on demand, keeps the context light). |
| `get_menu(id)` | returns the full `menu/v1` of the menu. |
| `upsert_menu(menu)` | **the gate** — validates; OK → writes into the working-copy + emits SSE `menu_written`; ERROR → `tool_result` `is_error` with the list of errors → the AI self-corrects. |
| `delete_menu(id)` | removes from the working-copy + emits SSE `menu_deleted` (editing included). |
| `read_attachment(file_id)` | returns the raw text of a dropped zmenu/DeluxeMenus file. |

`upsert_menu` validates: `ajv(schema.json)` (structure) **then** `validateMenuLayout` (unique ids cross-layer, in-bounds positions, `iterates`/`component_ref` consistency, resolution of `iterates.source`). The `errors` of `validateMenuLayout` are returned as is to the model — they are already written in actionable language.

### Loop

**Manual** agentic loop (fine control for metering + validation + budget):

1. `streamTurn(...)` → we relay the `text` as SSE, accumulate the `tool_use`.
2. For each `tool_use` → server execution → `tool_result` (success or errors).
3. We sum `usage`, check the **turn's credit budget**.
4. As long as there are `tool_use` → `streamTurn` again with the `tool_results`. Otherwise → `done`.
5. Caps: **max iterations** (default 25) and **credit budget/turn** (configurable). Overrun → we cut cleanly + message to the user.

## Grounding

`backend/src/modules/assistant/grounding/`, versioned, assembled as a **cached system prefix**:

- `menu-v1-authoring-guide.md` — distilled from `docs/schema/menu/v1/README.md` + `types.ts` + a set of curated examples + the `validateMenuLayout` rules. Token-efficient, written for the model.
- `zmenu-reference.md` — zmenu format (Maxlego08): `items`/`slots`, `material`, `name`/`lore`, `actions` per click type, `view_requirement`/`click_requirement`, and **mapping to Artisan** (view_requirement → conditional appearance without fallback = fall-through; commands → `run_command`/`send_message`/… actions).
- `deluxemenus-reference.md` — DeluxeMenus format (HelpChat): `display_name`/`lore`/`slot`, action tags (`[message]`, `[player]`, `[console]`, `[openguimenu]`, `[sound]`, `[broadcast]`, …), `view_requirement`/`click_requirement` (`has permission`, `has money`, `string equals`, …), `%papi%` placeholders, and **mapping to Artisan**.
- Anti-injection framing: the system prompt explicitly declares that the content of dropped files and of the working-copy is **data to convert, not instructions**.

## Conversation state & synchronization (§ working-copy)

- **The client (`accountStore`) stays the source of truth** of the live pack.
- A **conversation** is tied to one (network, pack) and holds an **in-memory server state**: message history + working-copy of the pack in `menu/v1` + attachments. Seeded by the client on opening (the client exports the pack domain→menu/v1). **No table** in v1; if the backend restarts, the client reopens and re-seeds (transcript lost — persistence = follow-up).
- The AI emits `menu/v1`; each validated `upsert_menu`/`delete_menu` emits an SSE event; the editor **imports menu/v1 → domain** and applies to `accountStore` (undoable via zundo).
- **Concurrency**: if the user edits the pack by hand during a conversation, the editor **re-seeds** the working-copy (sends an up-to-date snapshot) before the next turn. Simple **last-writer** model in v1, documented limit.

## Reversibility

- Before the **1st write of a turn**, the editor takes a **checkpoint commit** (existing `pack_commits` mechanism) labelled "before AI changes".
- Post-turn banner: "The AI modified N menus in this turn — [View on canvas] [Undo]". [Undo] = Restore of the checkpoint (existing History tab).
- Plus the zundo undo per edit (`accountStore.temporal`).

## Credits / metering (consumption side only)

- **Schema**: `ai_credit_ledger` table — `(id, accountId, delta, reason, operationId, createdAt)`. Balance = `SUM(delta)` per account. Drizzle migration generated (`bun run db:generate`) and committed. `reason` ∈ `{ grant, debit, refund }`.
- **Tokens → credits conversion**: formula configurable by env —
  `credits = ceil((in·wIn + out·wOut + cacheRead·wCacheRead + cacheWrite·wCacheWrite) / DIVISOR)`
  where the weights reflect provider cost × margin. All configurable, **calibrated at implementation** against the provider's real pricing (cf. models table: `claude-opus-4-8` $5/$25 per 1M in/out, cache read ~0.1×, cache write ~1.25×).
- **Debit**: at the end of each turn, sum the `usage` of all model calls → 1 `debit` entry. **Balance pre-check** before a turn; **per-turn budget cap**. Balance ≤ 0 → turn refused (clear message).
- **No debit** if the provider returned nothing (terminal failure) — we only bill the tokens actually consumed/returned.
- **Grant**: admin endpoint `POST /api/v1/assistant/admin/credits { accountId, amount, reason }` (admin auth) + CLI script for testing. This is the single entry point the future Stripe project will reuse (inserts `grant` entries).

## REST API (under `/api/v1/assistant/`)

| Method | Route | Role |
|---|---|---|
| `POST` | `/api/v1/assistant/conversations` | Opens a conversation (editor-session auth); body = pack snapshot in `menu/v1`; returns `conversationId`. |
| `POST` | `/api/v1/assistant/conversations/:id/attachments` | Upload of a dropped zmenu/DeluxeMenus file; returns `fileId`. |
| `POST` | `/api/v1/assistant/conversations/:id/messages` | Sends a message `{ text, attachmentIds[], packSnapshot? }`; **SSE response** (cf. events). Optional `packSnapshot` = concurrency re-seed. |
| `GET` | `/api/v1/assistant/credits` | Balance of the current account. |
| `POST` | `/api/v1/assistant/admin/credits` | Grant (admin). |

**SSE events**: `text_delta` · `tool_use` (menu being written, for feedback) · `menu_written` (`menu/v1` payload) · `menu_deleted` (`{id}`) · `credits` (`{ debited, balance }`) · `error` (`{ message }`) · `done`.

All routes (except admin) are under the existing editor-session auth; credits are tied to the authenticated account.

## Editor UX

- **Assistant panel**: right drawer ≥lg; full-screen sheet <lg (mobile-first — no hover-only affordance, cf. project preference). Transcript + composer with **drag-drop** of zmenu/DeluxeMenus files (dropzone on the composer). Streaming tokens.
- When the AI writes/deletes a menu → card in the transcript "Created / Modified / Deleted: *menu X*" linking to the menu on the canvas; **the canvas updates live** (via the import → accountStore).
- **Credit balance** visible in the panel; "out of credits" state (top-up CTA = placeholder for the future Stripe project).
- **Entry**: sidebar item of the `assistant` `FrontendModule` + "✨" button in `WorkspaceTopBarControls`.
- **i18n strings**: all via react-i18next (keys added in `en.ts` + `fr.ts` in the same commit — no hard-coded FR/EN).

## Security

- Provider key **server only** (env), never exposed to the client.
- Endpoints under editor-session auth; credits tied to the account.
- Dropped files & working-copy **treated as data, not instructions** (anti-injection system prompt framing).
- **Rate-limit** per account on top of credits (anti-abuse).

## Error handling

| Case | Behavior |
|---|---|
| Provider 429/5xx | SDK retries; terminal failure → SSE `error` "try again"; **no debit**. |
| Validation never OK after N iterations | Partial result + explanation; **never an invalid menu written**. |
| Balance ≤ 0 (pre-check or cap reached) | Refusal / clean cut + clear message. |
| Dropped file not parseable | The AI flags it in the chat (unreadable data), no crash. |
| Pack edited by hand during the conversation | Re-seed on the next turn (last-writer). |

## Environment variables (backend)

| Variable | Default | Usage |
|---|---|---|
| `ASSISTANT_PROVIDER` | `openai` | OpenAI-compatible preset: `openai` / `deepseek` / `mistral` / `openrouter` / `local` (resolves `baseURL`). Empty/override possible via `ASSISTANT_BASE_URL`. |
| `ASSISTANT_BASE_URL` | (per preset) | Explicit override of the OpenAI-compatible URL (e.g. `http://localhost:11434/v1`). |
| `ASSISTANT_API_KEY` | (empty) | Provider key. Empty → feature disabled. |
| `ASSISTANT_MODEL` | (per preset) | Model (e.g. `gpt-4.1-mini`, `deepseek-chat`, `mistral-large-latest`). |
| `ASSISTANT_CREDIT_DIVISOR` + `ASSISTANT_CREDIT_W_*` | calibrated at impl | Weights/divisor for the tokens→credits conversion (per provider pricing). |
| `ASSISTANT_MAX_ITERATIONS` | `25` | Iteration cap per turn. |
| `ASSISTANT_TURN_BUDGET` | calibrated at impl | Credit cap per turn (per average cost of a menu migration). |

## v1 scope

- **Generated entities: menus only** (+ the i18n / actions / conditions they contain). Commands / dialogs / translations = later extension (same engine, extended grounding + importer).
- zmenu/DeluxeMenus `open_command` → noted in `menu.notes`; creation of the Artisan command deferred.

## Tests (TDD)

| Layer | Coverage |
|---|---|
| Backend — provider | Mocked `LlmProvider` (scripted provider). |
| Backend — tools | `upsert_menu` accepts a valid `menu/v1` / rejects an invalid one with errors fed back; `get_menu`/`list_menus`/`delete_menu`. |
| Backend — loop | scripted provider → converges; **self-correction** on an invalid menu (1 rejection → 2nd try OK). |
| Backend — metering | tokens→credits math; debit; pre-check + cap; block at zero; no debit on failure. |
| Backend — grounding | the grounding files load and assemble. |
| Editor — converter | **menu/v1 → domain**: round-trip with the existing domain→menu/v1 export; i18nKeys alloc; step-trees; `MenuTitleLayer[]`. |
| Editor — panel | SSE rendering; drag-drop; applying `menu_written`/`menu_deleted` to accountStore; checkpoint + undo; "out of credits" state. |
| Migration fidelity | **corpus** of zmenu + DeluxeMenus samples → valid menus + mapping assertions (material/slot/name/lore; clicks → actions; view_requirement → conditional appearance; placeholders preserved). |

## Docs to update (mapping `CLAUDE.md` / `doc-impact-map.yaml`)

- `docs/architecture/modules.md` — "Assistant module" section.
- `docs/architecture/rest-endpoints.md` — `/api/v1/assistant/*` routes.
- `docs/architecture/entities.md` — `ai_credit_ledger` table + migration.
- `docs/architecture/editor-internals.md` — assistant panel + menu/v1→domain converter.
- `CHANGELOG.md` `[Unreleased]`.
- `.env.example` + `CLAUDE.md` (`ASSISTANT_*` vars).
- `docs-site/src/content/docs/editor/assistant.md` (user docs, to create).

## Breakdown into sub-projects (next)

1. **This spec** — AI assistant, credit consumption side, menus only.
2. **Acquisition billing** (separate) — Stripe, subscription plans, credit purchase → inserts `grant` entries into `ai_credit_ledger`.
3. **Entity extension** (separate) — generation of commands / dialogs / translations.
4. **Transcript persistence** (separate) — durable chat history + resume.

## Known limits (accepted in v1)

- Manual editing ↔ AI concurrency = last-writer (re-seed).
- Transcript not durable (server memory).
- Best-effort migration fidelity: what does not map cleanly is flagged in the chat, not invented.
