# Server import sources for the assistant

**Status:** design approved on 2026-09-04, not implemented.

## Problem

The Artisan assistant today accepts files dropped from the browser.
The editor reads their text, then sends it in `attachments` to the backend with the
conversation turn. This flow works when the administrator owns the files
on their machine, but it forces downloading then re-dropping menus already present
on the Minecraft server — notably the zMenu and DeluxeMenus configurations to
migrate.

The backend cannot read these files itself: it may live in another container or on
another machine. The Artisan plugin is the only component that has a reliable view
of the server's disk. Access must nevertheless stay much narrower than a general
file explorer, because plugin folders can contain secrets.

## Decision

Add to the assistant a second origin of attachments, **From the server**,
in addition to the **From my device** upload.

The accessible folders are **named import sources**, declared in the plugin's
`config.yml`. The plugin lists and reads their content on demand through the
existing WebSocket relay. The backend keeps no mirror of the files. A server
selection joins the assistant's current working copy and then follows exactly the
same conversion flow as local attachments.

## Goals

- Attach a file or folder already present on the server without a manual transfer
  through the user's machine.
- Preserve relative paths on a recursive selection so that the assistant can
  understand the references between menus.
- Allow several configurable roots, with ready-to-use examples for zMenu and
  DeluxeMenus.
- Keep the plugin master of its disk and only transport the explicitly selected
  files.
- Reuse the assistant's attachment and migration engine.
- Keep the local upload as the solution for files on the user's machine or when
  the server is offline.

## Out of scope

- Arbitrarily exploring the server's filesystem.
- Modifying, deleting or moving the source files.
- Synchronizing or backing up these sources in the backend.
- Creating a migration assistant separate from the existing chat.
- Supporting binary files; this first version only reads UTF-8 text filtered by
  extension.

## Plugin configuration

The plugin loads a map of sources under `assistant.import-sources`. The id is a
stable slug used on the wire; it is never interpreted as a path.

```yaml
assistant:
  import-sources:
    zmenu:
      enabled: true
      label: "zMenu"
      path: "plugins/zMenu/menus"
      extensions: [".yml", ".yaml"]
    deluxe-menus:
      enabled: true
      label: "DeluxeMenus"
      path: "plugins/DeluxeMenus/gui_menus"
      extensions: [".yml", ".yaml"]
```

The two known sources are present in the distributed `config.yml`. An
administrator can disable them, change their path or add as many named
sources as needed. A relative path starts from the server's working directory; an
absolute path is accepted only because it was explicitly declared by the
administrator in this local file.

An invalid, missing or unreadable source is omitted from the listing and produces a
precise WARN in the server console. It does not prevent the other sources from
working.

## User experience

The paperclip button opens a `DropdownMenu` with two choices:

- **From my device**, which triggers the current file input;
- **From the server**, which opens a selection `Dialog`.

The server picker contains:

- the choice of the configured source;
- a tree rebuilt from the relative paths;
- checkboxes, with an indeterminate state for folders;
- recursive selection of a folder;
- a search by name or path;
- the number of files and their estimated cumulative size;
- the **Refresh**, **Cancel** and **Attach** actions.

The listing returns a flat list of `{path, size}` files. The browser rebuilds the
folders and turns any folder selection into explicit file paths. A file added to
the disk after the listing therefore does not implicitly join the message.

After validation, each selection appears as a group of attachments,
for example `zMenu · 12 files`. The group can be expanded or removed. Local and
server attachments can coexist in the same turn.

If the server is offline, **From the server** stays visible but disabled
with an explanation. **From my device** stays available.

## Architecture and data flow

### Listing

1. The editor calls a REST route scoped by the currently open Network, Server and
   Project.
2. The backend checks the session, the Network membership and that the Project
   belongs to the requested Server.
3. The backend sends `import_sources_list` to the connected plugin, with a
   `request_id`.
4. The plugin walks each active source without reading the content and answers with
   the authorized metadata.
5. The backend relays the result without persisting it.

Proposed route:

```text
GET /api/v1/networks/:networkId/servers/:serverId/projects/:projectId/import-sources
```

Nominal response:

```json
{
  "sources": [
    {
      "id": "zmenu",
      "label": "zMenu",
      "files": [
        { "path": "shop.yml", "size": 1842 },
        { "path": "categories/blocks.yml", "size": 921 }
      ]
    }
  ]
}
```

### Sending a turn

The existing `attachments: Record<string, string>` contract stays unchanged for
local uploads. The body of a turn additionally accepts:

```json
{
  "serverAttachments": [
    {
      "sourceId": "zmenu",
      "paths": ["shop.yml", "categories/blocks.yml"]
    }
  ]
}
```

1. The editor sends the references, never the server content.
2. The backend redoes the access checks on the conversation and the Project.
3. Before launching the model, it sends `import_sources_read` to the plugin.
4. The plugin resolves the source by its id, revalidates each path and reads a
   UTF-8 snapshot.
5. The backend merges these files into the `WorkingCopy` attachments
   under ids `server:<sourceId>/<path>` to avoid any collision with a
   local name or another source.
6. The existing system note enumerates these ids; `read_attachment` reads their
   content as for a local upload.
7. The AI turn only starts after a complete and valid response from the plugin.

The backend creates no table, no cache and no persistent copy of the raw payload
read from the source. The raw result of `read_attachment` is replaced by a
non-sensitive marker before the transcript is saved. The responses and derived
artifacts produced by the model remain subject to the normal persistence of the
conversation and the Project; this guarantee does not seek to filter them.

## WebSocket protocol

The messages follow the `request_id`-correlated pattern already used by
`project_read` and `data_source_fetch`.

### `import_sources_list` — backend to plugin

```json
{ "type": "import_sources_list", "request_id": "uuid" }
```

### `import_sources_list_result` — plugin to backend

```json
{
  "type": "import_sources_list_result",
  "request_id": "uuid",
  "ok": true,
  "sources": [
    {
      "id": "zmenu",
      "label": "zMenu",
      "files": [{ "path": "shop.yml", "size": 1842 }]
    }
  ]
}
```

### `import_sources_read` — backend to plugin

```json
{
  "type": "import_sources_read",
  "request_id": "uuid",
  "selections": [
    { "source_id": "zmenu", "paths": ["shop.yml"] }
  ]
}
```

### `import_sources_read_result` — plugin to backend

```json
{
  "type": "import_sources_read_result",
  "request_id": "uuid",
  "ok": true,
  "files": [
    {
      "source_id": "zmenu",
      "path": "shop.yml",
      "content": "name: '&8Shop'\n"
    }
  ]
}
```

The nominal timeout is 5 seconds for the listing and 10 seconds for the
read. Earlier plugins ignore unknown types: the backend then expires
cleanly and presents the source as unavailable.

## Security

The security boundary is enforced in the plugin, never delegated to
the editor or the backend:

1. `source_id` must match an active source loaded from
   `config.yml`.
2. Paths are relative, non-empty, without `..` segments, and do not start
   with a separator.
3. The root and each target are canonicalized; the target must stay under the
   canonical root.
4. Symbolic links are rejected, including when an intermediate segment
   is a link.
5. Any hidden segment (`.` prefix), any folder and any extension absent
   from the allowlist are rejected on read.
6. Files must be regular, readable and decodable as strict UTF-8.
7. The result is read-only: no message, endpoint or write tool
   is created for these sources.

The backend requires an authenticated session and the same access that already lets
a member modify the Project. It also checks the Network → Server →
Project relation before the listing and before each turn. The configuration of the
roots stays a local action of the server administrator.

As for the current uploads, the system prompt reminds that the content of the
files is untrusted data to convert, never an instruction to follow.

## Limits and atomicity

Initial constants on the plugin side:

| Limit | Value | Behavior |
|---|---:|---|
| Entries listed per source | 5,000 | Source flagged `too_many_entries`, no partial listing |
| Files read per turn | 200 | Batch rejected |
| Size of one file | 1 MiB | Batch rejected |
| Cumulative size | 8 MiB | Batch rejected |

The editor warns about known overruns from the metadata, but the plugin
stays authoritative and recounts at read time.

Reading for a turn is all or nothing. If a source or a file is missing,
forbidden, turned into a folder, unreadable or too large, `ok` is `false`, no partial
content is handed to the assistant and no AI credit is consumed.
The user refreshes the selection or removes the failing files.

Protocol error codes:

- `unknown_source`;
- `invalid_path`;
- `unsupported_file`;
- `not_found`;
- `too_many_files`;
- `file_too_large`;
- `too_large`;
- `invalid_utf8`;
- `read_error`.

The backend also translates the absence of a connection into `503 server_offline`
and expirations into `504 fetch_timeout`.

## Affected components

### Plugin

- Parsing and validation of `assistant.import-sources` in the configuration.
- An isolated `ImportSourceReader` component responsible for the safe listing and
  reading; the WebSocket handler contains no file logic.
- Handlers of the four messages in `SyncedMenuProvider`, executed on the
  HTTP executor and never on the OkHttp callback.

### Backend

- Protocol types and two correlated relays in `hub.ts`.
- Resolution of the plugin responses and systematic cleanup of the pending requests.
- Listing route in `userNetworks.ts`.
- Resolution of `serverAttachments` in the assistant route before `runTurn` and
  before any credit consumption.
- Extension of the `WorkingCopy` only by merging the resolved attachments.

### Editor

- API client for the sources listing.
- Paperclip `DropdownMenu` and selection `Dialog`, built with the existing design
  system.
- Separate state for the local uploads and the server references.
- `serverAttachments` serialization when sending the turn.
- Server attachment groups in the composer.

## Error handling

- Source missing at listing: it is omitted, with a server WARN.
- No valid source: empty state explaining the expected configuration.
- Server offline: server choice disabled; local upload unchanged.
- Listing timeout: recoverable error in the Dialog with **Retry**.
- Read error at send: the message stays in the composer, the turn does not
  join the transcript and the user can fix the selection.
- Plugin too old: same presentation as a timeout / an unavailable feature, without
  making it look like the folder is empty.

## Test strategy

### Plugin

- Parses active, disabled, relative and absolute sources.
- Lists recursively with normalized and sorted paths.
- Excludes disallowed extensions, hidden files/folders and symlinks.
- Rejects traversal, neighboring prefix (`root-other`) and intermediate symlink.
- Applies the four limits and never returns a partial batch.
- Answers the two WS operations correctly off the OkHttp callback.

### Backend

- Listing route: unauthenticated, non-member, wrong Network/Server/Project,
  offline, timeout, nominal result and plugin error.
- Correlation and cleanup of the pending requests for the two messages.
- Assistant turn: local/server mix, collision-free ids, unknown source,
  partial read refused and no model call/credit on failure.
- Compatibility of a client that only sends `attachments`.

### Editor

- The paperclip keeps the local upload and offers the server.
- The Dialog rebuilds the tree, searches, selects recursively and computes
  the summary.
- The groups can be expanded and removed.
- The payload contains the explicit paths and mixes the two origins.
- The empty, offline, timeout and overrun states are understandable.

## Documentation to update with the implementation

- `docs/architecture/ws-protocol.md` — four new messages.
- `docs/architecture/rest-endpoints.md` — listing route.
- `docs-site/src/content/docs/getting-started/install-admin.md` — `assistant.import-sources`
  configuration and security rules.
- A user guide under `docs-site/src/content/docs/editor/` to attach and
  migrate server files.
- `docs/architecture/editor-internals.md` if the composer or a design system
  component changes structurally.
- `CHANGELOG.md` `[Unreleased]` for the new REST endpoint.

## Acceptance criteria

1. A member opening an online Project can select a zMenu folder and
   request its migration without downloading the files to their machine.
2. The assistant receives all the selected compatible files with their relative
   paths and can read them via `read_attachment`.
3. No undeclared, hidden, traversing or symlink-reached path can be
   read, even with a forged request.
4. An error on a single file entirely prevents the turn and its billing.
5. An offline server or an old plugin does not alter the local upload.
6. The backend persists neither a copy/cache of the raw payload of the imported
   sources, nor the raw `read_attachment` result. The responses and artifacts
   generated by the model keep the normal persistence policy of the conversation
   and the Project.

## Rejected alternatives

- **Mirror of the sources in the backend.** Offline browsing, but a
  persistent copy, leak risk and stale data.
- **Direct reading by the backend.** Does not work when the backend and the
  Minecraft server do not share the same disk.
- **Generic server explorer.** Disproportionate exposure surface and
  unnecessary for the migration need.
- **Separate "Migrate from the server" flow.** Duplicates the attachment
  engine, the errors and the interface without adding capability.
