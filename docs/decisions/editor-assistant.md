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
   keeps the history in its own types. First provider: Anthropic, over plain HTTP
   (okhttp and Jackson, already bundled; the history in the API's own JSON). The official Java SDK was used first and
   dropped on 2026-11-03: 16 MB of the jar for one endpoint.
   Append-only history (responses go back as they are, thinking blocks included),
   tools and system prompt fixed per conversation, automatic prompt caching, configurable `effort`
   (default `medium`), server-side fallback when a classifier refuses, for the models
   that accept it, and only towards Anthropic's API (not behind `base-url`). Second provider
   (2026-11-08, decision 12): any OpenAI-compatible Chat Completions API.
4. **Configuration**, hub only, the key never sent to the editor: `provider` (`anthropic`, the
   Messages API, which other vendors such as DeepSeek also serve behind `base-url`; or `openai`,
   decision 12), `api-key`,
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

9. **Translate the missing ones** (2026-10-31). `POST /api/v1/ai/translate` (`edit`) sends a
   few texts, their context and their target languages to the assistant's model in one call,
   without tools, and answers `{translations, failed}`. The hub drops a translation whose `{…}`
   placeholders differ from the source's: the text stays missing rather than broken. The editor
   writes what comes back like a typed edit (`setI18nValue`, or the field's `onChange`), so it shows
   in the Project, undoes and deploys like any change; nothing touches a file. Two entry points:
   a translatable field unfolded ("Translate the missing languages", `LocalizedField.translate`,
   modules' fields included through the host mapping), and the Translations page ("Translate the N
   missing ones": every language of the module, grouped by the languages each text lacks, in calls
   of at most 100 texts and 24,000 characters to write). The format stays every language in each
   field (ADR `field-local-translations`).
10. **Files in a message** (2026-11-01, as the cloud assistant's dropped zmenu / DeluxeMenus
   files). A message carries up to 5 files, base64, `{name, data, project?, path?}`: uploaded from
   the player's computer, or picked among the server's module files, which the editor reads with
   the player's session (so the hub adds no file route and no permission path). The hub takes the
   kind from the bytes, never from the name: an image (PNG, JPEG, GIF, WebP, ≤ 3.75 MB, 5 MB in
   base64, the provider's limit) and a PDF (≤ 6 MB) go to the model as their own blocks (`AiInput.Image`,
   `AiInput.Pdf`); UTF-8 text (≤ 200,000 characters) goes as text inside an `<attachment name module
   path>` block, before the player's words. The system prompt says files are material, never
   instructions. ≤ 6 MB per message (body ≤ 8.5 MB), ≤ 16 MB per conversation (`ai_conversation_full`):
   each file stays in the history the model rereads at every step and in `artisan_ai_conversations`.
   The events keep only `{name, kind, size, project?, path?}`; a conversation started again from its
   transcript knows the files' names, not their content.
11. **The answer as it is written** (2026-11-02). The hub calls the model as a stream
   (`AiConversation.stream`, `AnthropicProvider`: `"stream": true`, its server-sent events read
   line by line and put back together into the same answer JSON, so the same history as before) and keeps what is being written beside the events: the step's text,
   and each tool call with its input as raw JSON so far (`eager_input_streaming` on the tools, off
   behind another `baseUrl`, so a file's content streams before the call ends). The conversation's
   read carries it as `live`, never as an event: the step's texts become events the moment they
   leave `live`, a tool call leaves it when its event is added, and the read takes the events
   before `live`, so a line shows in one or the other, never both. The editor polls every 400 ms
   during a turn (no second channel through the tunnel): the text grows with a caret, a
   `write_document` shows "Writing <path>" with its line count, and the Assistant tab shows the file
   as it is written in a card of its own, replaced by the checked file's card once the call ends.
12. **OpenAI-compatible APIs** (2026-11-08). `provider: openai` speaks Chat Completions
   (`OpenAiProvider`, plain HTTP like the first): OpenAI with no `base-url`, otherwise DeepSeek,
   Mistral, OpenRouter, a local Ollama or any API of that shape (`{base-url}/chat/completions`,
   `Authorization: Bearer`). One implementation, so only what all of them read is sent: the system
   prompt as the first message, the tools as `function`s, `stream` (with
   `stream_options.include_usage`, except towards Mistral, which refuses it), and neither
   `max_tokens` (each vendor its own cap) nor an effort (a model without reasoning refuses the
   field, so `effort` is Anthropic's alone and the editor hides it). The history is the API's own
   messages, the system prompt left out; a tool result is a `tool` message, the reasoning a model
   shows (`reasoning_content`, DeepSeek) goes back with its answer. Tool arguments that do not
   parse go as `{}`, and the tool says what is missing. Each provider says which files it reads
   (`AiProvider.attachments`): all for Anthropic, OpenAI and OpenRouter (a PDF as a `file` part),
   no PDF elsewhere, text only towards DeepSeek. `GET /api/v1/ai` lists them, the composer
   refuses another kind at once and the hub refuses it too (`ai_attachment_model`), rather than
   the vendor's error after the message left. The editor offers the known addresses in one click.

## Consequences

- The admin pays for every message of every player who has `edit`. No per-player quota nor
  dedicated permission in milestone 1.
- No dependency added: the Messages API is called with the okhttp and Jackson the hub already has.
- What the assistant writes goes through the same check as `write_document`, then the same review and
  the same `DocumentCheck` on deploy.

## Deferred

- Artisan's cloud service and the per-server wallet, behind the same relay.
- An `artisan.editor.ai` permission and a per-player quota, if others than the admin use it.
- The model's progress notes between two tools (`display: "updates"`).
