# An MCP server in the hub: the AI writes drafts, a human deploys

**Status:** accepted (2026-10-25), milestone 0, behind `web.mcp` (disabled by default). Follows
`editor-web-server`, `editor-tunnel` and `server-identity-and-versions` (drafts in the database).

## Context

We want an AI to help build menus, commands, dialogs and Triggers. Two uses, one door: a cloud
assistant built into the editor (later, with no AI key on the admin's side), and the clients players
already have (Claude, ChatGPT, an IDE) through the Model Context Protocol. Full proposal:
`architecture/integration-ia-mcp.html` (project files).

Constraints: Artisan is self-hosted, the editor and the API live in the jar; published content lives
on the server's disk; an AI makes mistakes, and a file it writes reaches players as soon as it is
deployed.

## Decisions

1. **The MCP server is the hub.** `POST /mcp` on the editor's address (the default tunnel: HTTPS with
   no port to open), **stateless** Streamable HTTP, JSON responses only: no SSE stream, no
   `Mcp-Session-Id`. `GET`/`DELETE` → 405. Protocol versions: `2025-11-25`, `2025-06-18`,
   `2025-03-26`. No new service, no new network dependency. Tools block on the servers' responses:
   on 4 threads of their own, never Jetty's.
2. **The AI only writes drafts.** Six tools: `artisan_overview`, `list_documents`, `read_document`,
   `get_kind_guide` (read), `start_draft`, `write_document` (the player's private draft,
   `source: "ai"`). No tool deploys, deletes a Project, or copies a template. The only draft actions
   the MCP code can send are `list`, `read`, `create`, `update` (`McpProjects.DRAFT_ACTIONS`); an
   architecture test (`McpTest`) rejects any other action and any message name that writes to a disk
   in the `Mcp*` sources. The draft shows up in the editor's "Drafts": the player reviews the diff
   and clicks Deploy. This is the only path to the disk.
3. **Each file is checked by the Project's server before it enters the draft.** New message
   `documents_check` (protocol 1.4, `DocumentCheck`, `core` module): path (a Document's place), YAML,
   **JSON schema** of the `schema:` (`docs/schema`, embedded in the jar, `$id`s resolved from the
   classpath, never downloaded), then the server's `ProjectReader` on a temporary copy. The schema
   catches what the reader silently tolerates (`tittle:`). The check runs on the Project's server,
   not the hub: its Document types (modules included) and its version. The whole draft is checked as
   a Project (a command written before a menu that opens it). Failure → the tool returns `isError`
   with the problems, the draft does not move. Server offline or older → explicit refusal, no
   unchecked write.
4. **OAuth 2.1, consent in the editor.** RFC 9728 metadata
   (`/.well-known/oauth-protected-resource`) and RFC 8414
   (`/.well-known/oauth-authorization-server`), RFC 7591 dynamic registration (public clients,
   `https` or loopback), code + PKCE `S256` only. `/oauth/authorize` redirects to the editor's
   `/oauth/consent` page, where the player is signed in as usual (`/artisan editor`); the client
   never sees the cookie. An unknown client or an unregistered `redirect_uri` is never followed.
   Code: 60 s, single use, burned by a wrong verifier. Access: 1 h; refresh: 30 d, both rotate on each
   refresh. Everything is stored **hashed** (`artisan_mcp_clients`, `artisan_mcp_grants`).
5. **A client acts as the player, minus publishing.** The authorization's permissions = the player's
   minus `artisan.editor.publish` and `artisan.editor.config`, updated by the servers' permission
   reports (`Sessions.onPermissions`, like sessions). `/mcp` requires `artisan.editor.edit` on every
   call (403 `insufficient_scope` otherwise); without `view`, the authorization is deleted. The
   authorization is re-read from the database on every call: a revocation (Settings → AI apps) takes
   effect on the next one, on all servers sharing a database.
6. **The MCP and OAuth routes are `crossOrigin`.** They accept any `Origin` (a web client such as MCP
   Inspector, CORS `*` without credentials) but, when called from another origin, they receive no
   session: the cookie never acts for another site. From the editor itself (same origin), `/mcp`
   accepts the session: this will be the door of the built-in assistant.
7. **Disabled by default** (`web.mcp: false`) while it is a preview.
8. **Deploy goes through the same check** (2026-10-26). `project_write` and `project_draft_publish`
   run `DocumentCheck` on the tree they would write (renames and deletions included, `.artisan*`
   files excluded) before any compare-and-swap; a failure answers `invalid_documents` (`message`: one
   `path: problem` line per problem, `problems` as a list), nothing is written. The hub returns it as
   a 422; the editor shows the lines in Deploy's failure dialog. So that add-ons pass, the schema
   accepts the actions a server declares: a prefixed name (`guilds:rank_delete`) or
   `module_command`/`cancel_event`, arguments unchecked. A misspelled core name is still refused; a
   misspelled prefixed name passes. Prior measurement: the documents shipped with MSGuilds,
   artisan-auctions and artisan-attribution all pass (MSGuilds had 90 failures before the "declared"
   branch, attribution 15). Only one Artisan user at this date: block right away rather than run a
   warning phase.

## Consequences

- A player who has `edit` can entrust their drafts to an AI; the worst it does is a wrong draft,
  which they do not deploy.
- A deployment that would write a Document the server would not load is refused as a whole.
- The protocol moves to 1.4. An older leaf ignores `documents_check`: `write_document` refuses on its
  Projects with `plugin_update_required`.
- The jar embeds `networknt/json-schema-validator` (relocated, SLF4J provided by the server) and the
  `docs/schema` schemas.
- Registration is open to everyone (that is the principle of RFC 7591): beyond 1,000 clients, those
  more than an hour old with no authorization are purged; an attacker can evict a pending
  registration, not an authorization.

## Deferred

- Check prefixed actions and their arguments against what the server actually declares
  (`guilds:rank_delet` passes the schema today).
- Show the problems in the diff of the Deploy review, before the click, rather than after.
- The built-in cloud assistant, the per-server wallet and the "provider + admin's key" mode (the hub's
  `/ai` relay): next milestones of the proposal.
- Detecting reuse of a refresh token (revoke the whole authorization): this would require keeping the
  old hashes.
- Image and data tools (`write_blob`, data sources): not until the text flow has been put to use.
