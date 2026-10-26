# The editor's assistant, on the admin's key

**Status:** accepted (2026-10-26), milestone 1, behind the `ai` section of `environment.yml` (absent:
no assistant). Follows `mcp-server`.

## Context

Milestone 0 (`mcp-server`) opens Artisan to the AI clients players already have. The most direct
use remains: asking, from the editor open on a Project, "make me a VIP menu",
without installing a client or signing in elsewhere. The proposal plans two ways to pay for the
model: an Artisan cloud service (a wallet per server), or the admin's provider and
key. The cloud needs infrastructure and billing; the admin's key, nothing more
than the hub. One single Artisan user at this date: the admin's key first.

## Decisions

1. **The hub runs the loop.** `POST /api/v1/ai/conversations/:id/messages`: the hub calls
   the model, runs its tool calls, sends back the results, until the end of the turn. The key
   stays in the hub, never in the browser nor in the editor. The editor reads the events
   (`user`, `text`, `tool`, `notice`, `error`, `done`, numbered) by polling, asking only for
   the new ones (`?after=`); no stream to keep open through the tunnel.
2. **The same tools as `/mcp`, the same scope.** The assistant gets the seven tools of
   `McpTools` (`invoke`, shared with `McpRoutes`) and acts as the session's player, minus
   `publish` and `config`. It writes drafts checked by the server, it does not deploy. A
   draft it creates is offered in the panel: "Open in Drafts".
3. **A provider behind an interface.** `AiProvider` / `AiConversation`: each provider
   keeps the history in its own types. First provider: Anthropic, through the official Java
   SDK (`com.anthropic:anthropic-java`, bundled without relocation: it loads classes by name; okhttp and Jackson shared, those relocated).
   Append-only history (responses go back as they are, thinking blocks included),
   tools and system prompt fixed per conversation, automatic prompt caching, configurable `effort`
   (default `medium`), server-side fallback when a classifier refuses, for the models
   that accept it, and only towards Anthropic's API (not behind `base-url`).
4. **Configuration** (`environment.yml`, hub only, never sent to the editor): `ai.provider`
   (`anthropic`), `ai.api-key` (`${ANTHROPIC_API_KEY}` advised), `ai.model` (default
   `claude-opus-5-5`), `ai.effort`, `ai.max-steps` (model calls per message, 25), `ai.base-url`.
5. **Cost guards.** One turn per conversation at a time (`ai_busy`), `max-steps` calls per
   message, 16,000 output tokens per call, 10 conversations per player, forgotten after 6 h
   without activity. The tokens used are counted per conversation and shown at the end of the turn.
6. **Conversations in memory.** A restart ends them (the drafts written stay); the
   next message starts another one. Each conversation belongs to its player: anyone else
   gets 404.
7. **Who may use it: `artisan.editor.edit`**, like `/mcp`. `GET /api/v1/ai` tells the editor whether there
   is an assistant and whether the player can use it; otherwise the button does not show.

## Consequences

- The admin pays for every message of every player who has `edit`. No per-player quota nor
  dedicated permission in milestone 1.
- The jar grows by Anthropic's SDK (the `com.anthropic` package as is) and its schema generator; Jackson goes from
  2.17.2 to 2.18.3.
- What the assistant writes goes through the same check as `write_document`, then the same review and
  the same `DocumentCheck` on deploy.

## Deferred

- Artisan's cloud service and the per-server wallet, behind the same relay.
- Other providers (OpenAI-compatible APIs: Mistral, OpenRouter, Ollama): one more implementation
  of `AiProvider`.
- An `artisan.editor.ai` permission and a per-player quota, if others than the admin use it.
- Conversations in the database (surviving a restart, resuming on another device).
- Streamed text and the model's progress notes between two tools
  (`display: "updates"`).
