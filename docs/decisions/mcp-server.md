# An MCP server in the hub: the AI writes drafts, deploys only when the player allows it

**Status:** accepted (2026-10-25), milestone 0, behind `web.mcp` (disabled by default). Follows
`editor-web-server`, `editor-tunnel` and `server-identity-and-versions` (drafts in the database).
**Revised 2026-10-29** (decision 9): a client the player allowed may deploy; decisions 2 and 5 say
what holds by default.
**Decisions 12 (the kit as a module), 14 and 16 are replaced** by `common-images-and-themes`
(2026-11-25): they describe the code until that ADR's steps land.

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
2. **By default the AI only writes drafts** (deploying: decision 9). Seven tools: `artisan_overview`, `list_documents`, `read_document`,
   `get_kind_guide`, `read_docs` (read), `start_draft`, `write_document` (the player's private draft,
   `source: "ai"`). `get_kind_guide` answers in text: an outline of the schema (each field on one
   line, then each type, actions and conditions one per line, legacy shapes omitted, `SchemaOutline`),
   the actions the server's modules declare (`declared_actions`), how to write texts per
   language with the Project's languages, and an example from the Project (`KindGuide`); the full schema only with `detail: "schema"`. `read_docs` reads the release's user docs (`docs/site`, embedded in the jar under `wiki/`, `UserDocs`): without `page`, the list of pages; with one, the page in Markdown. No tool deletes a Project or copies a template. The draft shows up in the editor's
   "Drafts": the player reviews the diff and clicks Deploy. Until 2026-10-29 this was the only path
   to the disk; decision 9 adds a second one, the same publication, for a client the player allowed.
3. **Each file is checked by the Project's server before it enters the draft.** New message
   `documents_check` (protocol 1.4, `DocumentCheck`, `core` module): path (a Document's place), YAML,
   **JSON schema** of the `schema:` (`docs/schema`, embedded in the jar, `$id`s resolved from the
   classpath, never downloaded), then the server's `ProjectReader` on a temporary copy, then (API 1.9.0) the module that owns the file's kind (`DocumentChangeCheck`). The schema
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
5. **A client acts as the player, minus configuring, and minus publishing unless allowed.** The
   authorization's permissions = the player's minus `artisan.editor.config`, and minus
   `artisan.editor.publish` while the player has not allowed the client to deploy (decision 9),
   updated by the servers' permission reports (`Sessions.onPermissions`, like sessions). `/mcp` requires `artisan.editor.edit` on every
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
   a 422; the editor shows the lines in Deploy's failure dialog. Since 2026-10-26, Deploy's review runs
   the same check when it opens (`POST …/check`) and shows each problem on its file in the diff,
   before the click. So that add-ons pass, the schema accepts the actions a server declares: a
   prefixed name (`guilds:rank_delete`) or `module_command`/`cancel_event`. The schema does not know
   those declarations: the `actions` stage (`ActionCheck`, 2026-10-26) compares each prefixed action
   with the server's `declared_actions`. An undeclared name is refused, with the closest declared name
   (`guilds:rank_delet` → `guilds:rank_delete`), as is an unknown argument or a missing required one.
   Values are not checked (they are often expressions, `{r.id}`), nor a prefixed key under a list of
   conditions. Prior measurement: the documents shipped with MSGuilds,
   artisan-auctions and artisan-attribution all pass (MSGuilds had 90 failures before the "declared"
   branch, attribution 15). Only one Artisan user at this date: block right away rather than run a
   warning phase.

9. **A client the player allowed deploys, through the editor's own publication** (2026-10-29).
   - **Draft only by default.** An authorization carries `allow_publish` (`artisan_mcp_grants`,
     false by default). The player turns it on at consent (a box, offered only when they hold
     `artisan.editor.publish`) or in Settings → AI apps (`PATCH /api/v1/user/mcp/grants/:grant`,
     403 without that permission). It acts only while the player holds `artisan.editor.publish`: the
     client has no right of its own, and loses it with the player.
   - **Two separate tools.** Writing stays `start_draft`/`write_document`; deploying is
     `draft_publish(project, draft_id, expected_revision, dry_run?)`. It sends the draft action
     `publish`, the one the editor's Deploy sends (`ProjectDrafts`): the draft's revision as
     compare-and-swap (a draft changed since it was reviewed is not deployed), the baseline against
     the disk (`conflict`), `DocumentCheck` on the server (`invalid_documents`, decision 8). The MCP
     code builds no publication message itself: the architecture test still rejects
     `project_draft_publish`, `project_write` and their kin in the `Mcp*` and `Ai*` sources, and any
     draft action but `list`, `read`, `create`, `update`, `write_blob`, `publish`. `publish` is
     refused (`forbidden`) for a principal without `artisan.editor.publish`, and a client without it
     is not offered the deploying tools (`tools/list` follows the principal; `destructiveHint: true`
     on those it is).
   - **The client confirms.** Artisan does not ask the player a second time: the client shows the
     change and asks (the tool's description says so). `dry_run: true` returns the diff and the
     server's check without deploying; the deploy's answer carries the diff again, the new Version's
     number (waited for up to 5 s, the server records it once loaded) and the previous one.
   - **Attribution and rollback.** The publication carries `author_via` (the client's name): the
     Version reads "<player> via <client>" (`artisan_versions.author_via`, shown in the history).
     `list_versions` lists the Versions; `version_rollback(project, version, expected_version)`
     builds a draft from that Version (texts, and the images and fonts the server no longer has,
     through `write_blob`), `restoredFrom` set, and publishes it the same way; `expected_version`
     must be the newest Version, so a deploy that came since is not undone blindly.
   - **The editor's assistant stays draft only** (ADR `editor-assistant`): the player is in the
     editor, next to Deploy and its review; deploying from the conversation would skip that review
     to save one click. It is offered no deploying tool.
   - **Creating a module** (2026-10-30). `create_module(server, name)` makes an empty Project
     folder (`project_create`, as the editor's "New module"), for a principal with
     `artisan.editor.publish`, like the editor's route. Not destructive: the folder holds nothing,
     and nothing in it runs before a draft of it is deployed. Offered to a client the player let
     deploy, and to the editor's assistant when the player holds `artisan.editor.publish`: the
     assistant's principal keeps that permission with `deploys = false` (`McpPrincipal.canDeploy`),
     so the deploying tools stay refused, and it resolves only the non-destructive tools
     (`McpTools.draftOnly`). The tools, `artisan_overview` and the instructions tell the model the
     player calls a Project a module (the overview's add-on list is `addons`).
   - **The resource pack** (2026-10-31), when the hub builds packs (`PackBuilder`): `resource_pack_status(server)` (read only,
     everyone) returns the hub's Java SHA-1, the editor's, whether they match, the applied Bedrock
     SHA-1 (`bedrock_sha1`), when, and the build error; `resource_pack_rebuild(server, wait_seconds)`
     asks `PackBuilder.request` and waits up to 120 s (default 30) for the build, a build still
     running answering `done: false` (read `resource_pack_status` later). Rebuilding is
     destructive: deploying tools only, because a changed Bedrock pack reaches every Bedrock player
     (the Java pack too since the hub applies it: `mode: "server"`; `mode: "shadow"` on a hub that
     only compares it with the editor's).
   - **Alternatives set aside:** a single "write and deploy" tool (no point where the player sees
     the whole change); a confirmation step in Artisan (a second screen for a yes the client already
     asked, and a link to follow from a chat); a scope in the OAuth sense (clients ask for scopes at
     registration, and the choice belongs to the player, after).

10. **Images in a draft** (2026-11-24, first step of the design `design-ia-menus-assets-2026-11-24`,
   project files). `write_image(project, draft_id, name, use, pixels | png_base64, delete?)` puts a
   menu's image in the draft; `read_image(project, path, draft_id?)` shows one; `list_documents`
   lists them (`images`).
   - **Pixels as data, never code.** `pixels` is a palette of one-character keys and one string per
     row (`McpImages.fromPixels`): the model sets every pixel, with no drawing primitive to limit
     it and nothing to run on the server. `png_base64` takes an image a client made on its side
     (Claude Code and others have their own sandbox). Either way ≤ 512 px a side (read from the
     PNG header before decoding), ≤ 2 MB, and re-encoded by `Png` as plain 8-bit RGBA.
   - **Where it goes.** `use: button` → `assets/textures/<name>.png`, descriptor `usages: [button]`;
     `use: background` → `assets/glyphs/<name>.png` with `ascent: 13` and the first codepoint no
     descriptor of the draft has (U+E000..U+F7FF, as the editor offers it; the build still settles
     collisions between Projects). Writing over an image keeps its place and its descriptor but the
     size. The bytes go through `write_blob`, then one `update` sets `binaryTree` and the
     descriptor: the draft actions are unchanged, and so is the protocol.
   - **The model sees what it wrote.** A tool may answer with pictures (`McpTools.Shown`,
     `Outcome.pictures`): the image enlarged to at least 256 px, nearest neighbour, over a dark
     chequerboard, sent as an MCP `image` content block after the JSON. The JSON says the size, the
     colour count and the partly transparent pixels; `read_image` adds a small image's pixels as
     `write_image` takes them.
   - **Draft only.** Both tools are offered to every principal with `edit`, the editor's assistant
     included. Rebuilding the pack stays a deploying tool.
   - **The editor's assistant sees them too** (ADR `editor-assistant`, decision 14): a tool's
     pictures go to its model with the result, when the model reads images.

11. **A menu as a picture** (2026-11-24, third step of the same design).
   `render_menu(project, path, draft_id?, lang?, scale?)` draws a whole menu, as deployed or as a
   draft has it, so the model judges the layout and not one image at a time.
   - **Drawn by the pack module** (`MenuPictures`, pure): the container (the jar's vanilla textures,
     unless `vanilla_texture: false`), the title's layers at their chest coordinates (`background`,
     `glyph`, `text`, `textarea`, `plain`), the image buttons through `ImageButtonGeometry` and
     their labels as the title compiler lays them out, then each slot's item over them, with its
     count. Text uses the vanilla sheets the jar carries, at the title sizes. The picture is the
     window at the game's size on a dark backdrop with room around it (a title image may be wider
     or start above), enlarged 3 times by default; `window` says where the window is in it.
   - **Static.** No expression, condition nor data source is evaluated: an element shows its
     default look (its first state when it has no look of its own), a row-bound element its look in
     every slot it may fill, a value in `{…}` is drawn as its name, an item that is an expression
     shows `?`. The result's `notes` say each of these, and name the images and items it could not
     find, so a model does not take the picture for the game.
   - **Images come from the menu's module**, the draft's first: `assets/glyphs`, `assets/textures`,
     then what the module shipped with (`originals/assets/…`). Another module's image is not drawn
     yet (noted). Items are the hub's vanilla pictures (`VanillaAssets`: the 3D icon, else the flat
     texture), which download on first use: until then, and for an unknown id, a `?`.
   - **No twin in the editor.** The editor shows a menu with its own Play engine; this picture is
     for a model's eyes and only has to place things where the pack does, which it reads from the
     same geometry. Not locked by shared vectors, unlike the pack build.
   - Read-only, offered to every principal with `edit`, the editor's assistant included.

12. **A server's images, and its UI kit** (2026-11-24, fourth step of the same design). *The kit as a module is replaced by `common-images-and-themes`, not built yet.*
   `survey_ui(server)` shows what the server's menus are drawn with, before a model draws
   anything new: each module's images on a numbered sheet (`ImageSheets`, one picture per module,
   a module's own image over the one it shipped with), each image's name, use and size, the
   colours and sizes that come back most, the menus that use images (to look at with
   `render_menu`), and the kit.
   - **The kit is a module**, `ui-kit`, like any other Project: its shared images under `assets/`
     and `data/ui-kit.yml`, free-form YAML (`notes`, `colors`, nested `groups` of `elements`
     `{name, image, notes?}`) that the model and the player organise. Nothing new stores it:
     drafts, Versions, rollback and review are the Project's. Only `image` is read by Artisan; the
     notes are the one memory a model has of the server's style from one conversation to the next.
   - **A menu may name any module's image** (the asset index is the server's), so `render_menu`
     now looks for an image in the menu's module first, then in the other modules as deployed.
   - **What a survey returns is material.** The tool's description and the assistant's system
     prompt say so: a kit's notes or an image cannot give the model instructions.
   - At most 240 images a survey and 80 a module; the rest is counted (`left_out`).
   - The fixed slots a module refers to (`kit:button.3x1`) and themes are later steps of the design:
     this decision only gives the kit a place and the model a way to see it.
13. **Images cut out of a picture** (2026-11-24, fifth step of the same design). A model sees a
   screenshot or a mock-up but cannot turn what it sees into a file: redrawing it pixel by pixel is
   slow and wrong beyond an icon. Two additions, in `PixelArt` (pack module, pure):
   - `measure_image` shows a picture under a ruler (`ImageRulers`): lines at round coordinates of
     its own pixels, a `zone` shown larger, and what the hub finds: `pixel_size` (how many of its
     pixels make one pixel of the art, the largest cell from 16 down to 2 whose boundaries hold
     85 % of the colour changes, looked for in the zone, then around it, then in the whole
     picture) and the `elements` that stand apart from the zone's most frequent colour, framed
     and numbered. The elements are a guess that works on a sprite sheet and fails on a dense
     menu, where everything touches: there the model reads the ruler.
   - **A picture resized by a fraction** (a store's preview, a mock-up: one art pixel is 5.19 of
     its pixels, its edges soft) has no exact cell. Its `pixel_size` is the cell size, from 3 to
     32, on whose boundaries the colour changes fall best across and down at once (each change a
     turn of `position / size`, summed: a Fourier term), kept only when the picture is drawn in
     those cells: between two cells' middles every pixel is one of the two colours or a mix of
     them. Lines one pixel wide at an even pitch (an inventory at its own size) fall on such
     boundaries too, but are a third colour: no grid. A turned picture has none either. The
     picture's pixel wins over a zone's when the zone's is a whole number of them (a chequered
     block reads as a larger pixel on its own).
   - **The slots of an inventory** are a frame, not elements: rows and columns of which one
     colour holds half, two side by side at most, each running on, drawing two cells at least.
     They leave the mask and part what stands in them, an icon that fills its slot included. One
     outlined rectangle stays an element with its outline. The frame is looked for in the zone,
     then within what its lines cover.
   - `write_image` takes `from`: a rectangle of a picture, brought back to one pixel per pixel of
     the art (each pixel the colour its cell holds most, read away from the cell's edges), on the
     grid found or at the `pixel_size` given (which may be a fraction). `background: remove`
     looks two art pixels around the rectangle, makes the colour found there transparent from the
     edge inward, leaves out what reaches the edge without reaching the middle (a neighbour the
     rectangle cut), and trims: the rectangle only has to hold the element. `remove_all` empties
     a frame's inside too; a colour (`#8b8b8b`, the zone's `background`) names the ground of an
     element whose rectangle has nothing around it (an icon in a slot, its frame next to it): it
     goes from the rectangle's own edge inward, and the rectangle is not widened. `colours`
     limits the palette (median cut); the close colours of a JPEG, or of a picture resized by a
     fraction, are settled first. A `pixel_size` given by hand is laid on the art's own cells. The answer says what was cut (`cut_from`) and shows the image, like any
     `write_image`: the model corrects by art pixels.
   - **The picture is an attachment or a module's image.** In the editor's assistant, a picture
     the player attached, by its file name (ADR `editor-assistant`, decision 15). Over MCP a
     client cannot hand a tool the bytes of what its model sees: the picture is an image of a
     Project (`path`), which the player uploads in the editor. A source picture is a PNG, a JPEG
     or a GIF's first frame, read by the JDK (`McpImages.source`), 4.2 million pixels at most
     (2560x1600), its size read from the header first.
   - The ruler's picture is a PNG the JDK compresses, or a JPEG above 400 kB (the game's world
     behind a menu): it is looked at, never written.

14. **The UI kit's base: `kit:<name>`** (2026-11-24, step 4 a of the same design). *Replaced by `common-images-and-themes`, not built yet.* A module's
    menus cannot be laid out against a server's own kit, which differs from one server to the
    next. So Artisan ships a base: 19 images under names and sizes that are public and never
    change (`editor/src/assets/kit`, listed in `slots.json`): `window.6`, `window.3`, `cell`,
    four `button.*.3x1`, `panel.3x1`, `card.3x2`, two `value.*`, four `arrow.*.1x2`, `close.1x1`,
    `back.1x1`, two `toggle.*.1x1`. A name ends with the slots the image covers, columns by rows.
    - **A menu names an image `kit:<name>`** where it takes one: an element's `image`, a title's
      `background` or `glyph` layer, a module's pack image. It is the image `<name>` of the
      server's `ui-kit` module, else the base's. The kit module's image replaces a slot of the
      base only at the slot's size: a menu laid out against `kit:button.3x1` keeps its place
      whatever the server draws. A name outside the base is the kit module's own image, so a
      server extends the kit by adding one.
    - **The base ships in the jar, not on the server's disk.** The design said "through the
      originals mechanism"; that needs a module on every server, a write at each start and a
      Project to show in the editor, for files nobody edits. Both pack builders read the base
      from their own resources (`Kit.kt`, `kit.ts`, one copy in git) and add an image only when
      a menu or a module names it: a server that names none keeps its pack byte for byte. A kit
      image a title is drawn with is a glyph of the menu font at the first codepoint no module's
      glyph has; the others are textures. Its files sit under `kit/` in the pack (`:` cannot be
      in a path), its key in the asset index is what the menu writes. The runtime did not
      change: it already looks an image up by the name the menu gives.
    - **For the model**: `survey_ui` returns `kit_base` (each image, its size, whether this
      server drew it, on one more sheet), `render_menu` draws `kit:` images, and `write_image`
      in the `ui-kit` module takes a base name, refused at another size than the slot's.
    - **In the editor**: a menu's canvas, title and inspector show `kit:` images, from the kit
      module's published files (`state/kitStore`, fed by the server index); **UI kit** beside
      Item and Image picks one for a button, sized by the slots its name states, and the title
      layer form picks one for a window. Nothing is copied into the module.
15. **Composed images** (2026-11-24, step 4 b of the same design). Most of a module's images
    are a kit image plus a detail: a window and its slots, a card and an icon. Kept as PNGs,
    they would not follow a server that redraws its kit. So an image may be a recipe instead
    of a file: a descriptor `assets/textures/<name>.yml` (or `assets/glyphs/`) with a `compose`
    list and no PNG of its name, which both pack builders assemble (`Compose.kt`, `compose.ts`).
    - **Layers, bottom first**: `use` or `image` places one image at `x`, `y`; `grid` repeats
      it `columns` by `rows`, at its own size (the slots of a window: `kit:cell`). A layer is
      `kit:<name>` or a PNG of the same module, never another composed image, so there is no
      order to resolve and no cycle. The image is as large as `width` and `height` say (both),
      else as far as its first layer reaches; what goes past is clipped. A layer whose file is
      missing is left out; none drawn, there is no image. A PNG of the same name wins over the
      recipe. At most 64 layers, 64 repeats, 512 pixels a side.
    - **Same bytes in both builders**: layers are blended with whole-number alpha compositing,
      and the result is an asset like a PNG's (same id, same place in the index, a title
      background's `ascent` and `codepoint` read from the same descriptor). A composed image of
      the `ui-kit` module is `kit:<its name>`, and replaces a slot of the base at its size.
      A server with no recipe keeps its pack byte for byte.
    - **For the model**: `write_image` takes `compose` ({layers: [{image, x, y, columns,
      rows}], width, height}) in place of pixels, writes the descriptor and returns the picture
      assembled. It is stricter than the pack: a layer that does not exist is refused, with what
      to name instead. `read_image` on the `.yml` returns the picture and the layers,
      `list_documents` lists them (`composed_images`), `render_menu` and `survey_ui` draw them
      (`composed_of`). Written as pixels afterwards, the image keeps its place and loses its
      recipe; composed again, its PNG.
    - **In the editor**: a composed image is listed with the others, its picture assembled in
      the browser (`features/assets/composedAssets.ts`, a `data:` URL). It is renamed,
      duplicated and deleted through its descriptor; a PNG cannot be imported under its name,
      and it is not offered for copying into another module, where its layers would be missing.
    - **Composer** (step 4 c): the detail of a composed image in the Resources page lays its
      layers out to be dragged, ordered, repeated, added from the kit or the module, and
      removed; **Compose an image** starts one from a kit window or a kit button. The editor
      writes the same descriptor as `write_image` (`use`, `image`, `grid`), and refuses a
      recipe the pack would not read back as given, so a person and a model edit one file.
    - **Pixel editor** (step 4 d): an image that has a PNG is retouched in the Resources page
      (pencil, eraser, colour picker, paint bucket, the image's and the kit's colours, undo),
      at its size, and **Draw an image** starts from an empty one. Kept small on purpose: no
      layers, no selection, no resizing. It is the hand's counterpart of `write_image`'s
      pixels: what the model drew is corrected there without leaving the editor, and beyond a
      detail the answer stays an import or the model.
16. **Themes of the kit** (2026-11-24, step 4 bis of the same design). *Replaced by `common-images-and-themes`, not built yet.* A server wants another
    look for a season or an event without rewriting a menu. A theme is the same images, under
    the same names and at the same sizes, with other pixels: a folder `themes/<name>/` of the
    `ui-kit` module, read by both pack builders (`Theme.kt`, `theme.ts`).
    - **Two means, the cheap one first**: `theme.yml` holds `colors`, a table of `"#rrggbb"`
      to `"#rrggbb"` (256 at most) applied to each pixel whose colour is in it, alpha kept, in
      one pass; `assets/textures/<image>.png` (or `assets/glyphs/`) is the theme's own drawing
      of an image, taken as it is when it has that image's size, left out otherwise. A theme
      holds no Document and moves nothing, so a menu laid out against the kit keeps its
      layout whatever the theme: at worst it is ugly.
    - **What changes is what `kit:<name>` shows**: the base's images and the kit module's.
      A composed image follows through its layers and is not themed a second time once
      assembled (the theme's own drawing of a composed kit image still replaces it). A
      module's own PNG is never recoloured: its colours were not chosen against the kit's,
      and a table applied blindly would repaint an icon that happens to share a green.
    - **One theme per server**, `resource-pack.theme` of `config.yml` (the Configuration
      page lists the kit's themes; the plugin checks the name, `invalid_theme`), passed to
      the pack builders as `PackInput.theme`. A theme the kit does not hold is no theme. A
      server that names none keeps its pack byte for byte. *Replaced on 2026-11-25 by a
      stack of themes in place, `resource-pack.themes` and `PackInput.themes` (ADR
      `common-images-and-themes`, decision 6, "Step 4, first part"): `survey_ui` gives the
      stack as `kit.in_place`, a render says the themes it was drawn in as `themes`.*
    - **For the model**: `survey_ui` lists the kit's themes (`kit.themes`), the one in place,
      how to write one (`themes_format`), and shows the base in the server's theme. The table
      is written with `write_document`, checked by the hub (the server does not check a file
      that is no Document): unquoted colours, which YAML reads as comments, are refused with
      the reason. `write_image` with `theme` writes the theme's drawing of a kit image,
      refused at another size. `render_menu` draws the kit in the server's theme, in another
      with `theme` (`none` for none), and from a draft of the kit module with `kit_draft_id`,
      so a theme is looked at on a real menu before it is deployed. Switching the server's
      theme stays the player's, in the Configuration page.
    - **In the editor**: kit images and composed images are shown in the server's theme
      (`features/assets/kitTheme.ts`), as players see them.
    - **Not in this step**: a theme per player, a module's own theme overlay (its PNGs
      redrawn per theme), a `themed: true` on a module's image to have it recoloured, and a
      screen to edit a theme's table by hand (it is a YAML file of the kit module).
17. **A picture from an image model: `generate_image`** (2026-11-24, step 6 of the same
    design). A chat model draws pixel art cell by cell; it cannot paint an illustration or a
    background. `generate_image` asks an image model for one, on the admin's key (`ai.image`:
    `openai`, the Images API with GPT Image models, or `google`, the Gemini API's image
    models; `AiImages.kt`, behind `ImageModel`).
    - **The picture is material, never a file.** It comes back at about a megapixel, kept in
      the hub's memory under a name (`generated-<n>.png`, each player's last 8,
      `GeneratedPictures`), with a compact copy for the model's eyes. `measure_image` and
      `write_image`'s `from` take it by that name as `attachment`, so it enters a draft the
      way a screenshot does: measured, cut, brought to the art's size, checked. Nothing new
      is written to a server's disk nor to the database.
    - **It spends the server owner's money, so it is off by default.** An MCP client is
      offered the tool only when its grant carries `allow_images` (migration 55): a box on
      the consent page, off unless ticked, and a switch per app in Settings → AI apps. It
      takes `edit`, like the assistant's own question (ADR `editor-assistant`, decision 16).
      Not listed and refused (`forbidden`) otherwise; `artisan_overview` says
      `can_generate_images`. Without an image model the tool does not exist.
    - **A number of pictures per player and per day** (`ai.image.daily-limit`, 40, UTC, in
      memory), all clients and the assistant together: the guard against a model that loops
      on a paid tool. A call the image model failed or refused is not counted.
    - **Transparency**: a model that makes a transparent background is asked for one; one
      that does not (Google's) gets a prompt that asks for a flat magenta ground, removed
      when the picture is cut (`from.background`).
    - **References** (4 at most): pictures the image model works from, an attachment or a
      module's image, a small one enlarged pixel for pixel before it is sent.
    - **Why not let the client generate on its side?** It can: `write_image` takes a
      `png_base64` it made. `generate_image` is for clients that have no image model, and for
      the editor's assistant, which has none.
    - **Not verified against the vendors** when this was written: no key was at hand. The
      requests follow the vendors' published API and are tested against a local stand-in;
      the first real call may show a field to adjust. The quality of pixel art from an image
      model is the open question of the design's benchmark.

## Consequences

- A player who has `edit` can entrust their drafts to an AI; by default the worst it does is a wrong
  draft, which they do not deploy. A player who allowed it to deploy can get a wrong deploy, checked
  by the server like theirs, named in the history, and undone with `version_rollback` or the
  editor's Restore.
- A deployment that would write a Document the server would not load is refused as a whole.
- The protocol moves to 1.4. An older leaf ignores `documents_check`: `write_document` refuses on its
  Projects with `plugin_update_required`.
- The jar embeds `networknt/json-schema-validator` (relocated, SLF4J provided by the server) and the
  `docs/schema` schemas.
- Registration is open to everyone (that is the principle of RFC 7591): beyond 1,000 clients, those
  more than an hour old with no authorization are purged; an attacker can evict a pending
  registration, not an authorization.

## Deferred

- The built-in cloud assistant, the per-server wallet and the "provider + admin's key" mode (the hub's
  `/ai` relay): next milestones of the proposal.
- Detecting reuse of a refresh token (revoke the whole authorization): this would require keeping the
  old hashes.
- Data tools (data sources): a next step of the design named in decision 10. For
  `generate_image`: a price shown before the call (the site's catalogue has it for
  `image.provider: artisan`, ADR `editor-assistant` decision 16), other vendors, and pictures that outlive a restart. For `render_menu`: a state chosen by the caller, sample values for
  expressions, hover text (name and lore). For the kit: a screen for a theme's colours, themes
  for a module's own images, and its place in the editor's Resources page. For `measure_image`: a pixel size that is not
  whole found by itself (a mock-up from an image model), elements inside a dense menu, a WebP.
- Deploying several Projects in one call, and a per-client limit on deploys.
