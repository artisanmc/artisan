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
   draft it creates is offered in the panel: "Open in Drafts". Since 2026-10-29 an MCP client
   the player allowed may deploy (ADR `mcp-server`, decision 9); the assistant keeps the
   draft-only tools (`McpTools.draftOnly`): the player is next to Deploy and its review.
   Since 2026-10-30 it may also create an empty module (`create_module`) for a player who holds
   `artisan.editor.publish`: its principal keeps that permission but never deploys
   (`deploys = false`, ADR `mcp-server`, decision 9).
3. **A provider behind an interface.** `AiProvider` / `AiConversation`: each provider
   keeps the history in its own types. First provider: Anthropic, through the official Java
   SDK (`com.anthropic:anthropic-java`, bundled without relocation: it loads classes by name; okhttp and Jackson shared, those relocated).
   Append-only history (responses go back as they are, thinking blocks included),
   tools and system prompt fixed per conversation, automatic prompt caching, configurable `effort`
   (default `medium`), server-side fallback when a classifier refuses, for the models
   that accept it, and only towards Anthropic's API (not behind `base-url`).
4. **Configuration**, hub only, the key never sent to the editor: `provider` (`anthropic`, the
   Messages API, which other vendors such as DeepSeek also serve behind `base-url`), `api-key`,
   `model` (default `claude-opus-5-5`), `effort`, `max-steps` (model calls per message, 25),
   `base-url`. Set from the editor (Settings → Assistant, `artisan.editor.config`), stored in
   `artisan_settings` and applied at once (`AiSetup` rebuilds the assistant; its conversations
   go on, decision 6). The servers of a database share one tunnel address and each serves the editor (ADR
   `peer-servers`): each reads the settings again every 30 s, so a save on one reaches the
   others within that, and unchanged settings keep the assistant: one setting for the whole network instead of one file per server (2026-10-28). The key
   is write-only: the editor sees its last four characters, and changing the provider or the
   address asks for it again, so it cannot be sent elsewhere without being known. The `ai`
   section of `environment.yml` (`${ANTHROPIC_API_KEY}` advised) still works and wins: the editor
   then shows it read-only.
5. **Cost guards.** One turn per conversation at a time (`ai_busy`), `max-steps` calls per
   message, 16,000 output tokens per call, 10 conversations per player (a new one drops the
   oldest), out of the hub's memory after 6 h without activity, out of the database after 30 days. The tokens used are counted per conversation and shown at the end of the turn.
6. **Conversations in the suite database** (2026-10-30, until then in memory: a restart ended
   them). `artisan_ai_conversations` (migration 37): owner, scope, title, tokens, the editor's
   events and the provider's history (`AiConversation.history`, the SDK's own JSON for Anthropic,
   thinking blocks included), saved after every model call. A restart, a change of the settings,
   or another server of the database (the one the tunnel now sends the editor to) takes a
   conversation back when the editor asks for it. The history goes on only under the same
   `historyKey`: provider, address and model, plus a digest of the system prompt and the tools;
   anything else (another model, a new plugin version with other instructions) starts the model
   again with a transcript of the events, sent once before the next message, since a history
   from elsewhere may be refused (thinking blocks are bound to their conversation). A turn cut by a
   restart ends with the notice `ai_interrupted`; tool calls left without result are answered as
   interrupted with the next message. Two servers running one conversation at the same time is
   not guarded: the editor talks to one server at a time (ADR `peer-servers`). Each conversation
   belongs to its player: anyone else gets 404.
7. **Who may use it: `artisan.editor.edit`**, like `/mcp`. `GET /api/v1/ai` tells the editor whether there
   is an assistant and whether the player can use it; otherwise the button does not show.
8. **A server-level view, the whole server as its scope** (2026-10-29). Besides the panel docked
   on a Project, the server page has an **Assistant** tab: the conversation in the middle, the
   player's conversations on the left, and one card per file the assistant wrote on the right,
   naming its Project (a menu shows as the game would, through the Play engine over the draft's
   version of its Project; any file as YAML against the disk). A conversation carries the
   `server` it was started on (`POST {server}`): the system prompt tells the model the server's
   Projects are its scope, one draft per Project. "Review and deploy" opens Deploy's review with
   every draft of the conversation picked (multi-Project deploy). The panel's "Expand" opens the
   same conversation in the tab: the editor keeps the conversations it read in one store, so both
   views show the same events, polled once. The tab is in the free jar, like the panel: it is
   how players discover the assistant (and, later, the cloud offer).

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
- Streamed text and the model's progress notes between two tools
  (`display: "updates"`); with them, the file being written known early and animated in the
  Assistant tab.
