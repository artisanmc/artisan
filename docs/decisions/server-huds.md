# Server HUDs — a `hud` Document kind in Artisan, modules provide variables

**Status:** proposed (2026-11-28), draft, not yet accepted. Revised the same day after review:
scope reduced to the kind and its runtime; corners and Bedrock moved to *Next steps*.
**Builds on:** `triggers-and-variables` §10 (module variables), the HUD layers of `modules.md`
(`OverlayApi`, `OverlayLayout`, `Slot.ACTION_BAR` / `Slot.BOSS_BAR`), `extensible-document-kinds`
(itself still proposed).
**Supersedes, once delivered:** ArtisanQuests' `quest_hud` kind (artisan-quests #66, #67).

## Context

Every HUD drawn today belongs to a module: the conversation modes of ArtisanConversations (action
bar) and ArtisanQuests' tracked quest (`quest_hud`, boss bar). Each module declares its own kind,
reads its own file, composes its own `OverlayLayout` and calls `api.getOverlay().show`. That works
while the HUD shows one module's state.

The next requests do not fit (Iban, 2026-11-28):

- a **server HUD** the admin writes: the player's money, rank, online count, a "scoreboard"
  drawn as a HUD, **permanent, conditional or temporary**;
- a HUD **anchored in a corner** (top left, top right) rather than centred;
- a HUD mixing **several modules**: the tracked quest next to the money;
- **Bedrock** players (Geyser) see it too.

None of them belongs to a module. And what is module-specific in `quest_hud` is only *which
values* it shows (`objective_name`, `objective_progress`…), which module variables
(`{var.<module>.<name>}`, §10) already carry, typed, offered by the editor, resolved on the
player's thread.

What is already shared and stays as is: the `OverlayLayout` format and its reader, the editor's
`OverlayComposer`, the pack images (`pack.images`), the slots and their layer stacking by priority
(`OverlaySlots`, `HudBossBars`).

## Decision (proposed)

1. **A `hud` Document kind in Artisan core**, folder `huds/` of any Project, schema `hud/v1`:
   ```yaml
   enabled: true             # default true; false = loaded, never shown
   slot: boss_bar            # boss_bar (default) | action_bar ; anchors come with the shader step
   priority: 100             # among the other layers of the slot, as OverlaySlots stacks them
   refresh: 20               # ticks of the fallback tick (§3): 0, or 5..1200
   when: [ ... ]             # optional conditions (the ConditionsEditor list); false = hidden
   layout: [ ... ]           # an OverlayLayout, `image` and `text` layers only
   texts:                    # MiniMessage of each named text layer, with {…} templates
     money: "<gold>{var.economy.balance} ⛃"
     quest: "<white>{var.quests.tracked_objective} <gray>[{var.quests.tracked_progress}/{var.quests.tracked_target}]"
   ```
   - **Layers.** `hud/v1` accepts `image` and `text`. A `list` or an `image_slot` is a validation
     problem: they are filled by code, frame by frame, and stay the tool of a module that draws
     through `OverlayApi`. The core wraps each text to its layer's `width` and `lines`
     (`OverlayApi.width`), which a module does itself today.
   - **Who sees it.** Every enabled `hud` is shown to every online player for whom `when` holds
     and for whom `hasPack` is true. Anyone else sees nothing from it: a HUD has no chat fallback
     (a module that needs one, like the tracked quest's boss bar, keeps it on its side, §6). An
     image the pack lacks is left out and reported (console, editor), the rest is drawn.
   - **Network.** A HUD is rendered on the server the player is on, from the Projects that server
     loaded. A module variable whose module is absent on that Leaf is absent (§10): its text is
     empty, one warning per name.
2. **Texts are ordinary templates.** `{var.…}`, `{player}`, PAPI `%…%`, expressions: the same
   engine and the same `{` autocomplete as the lore. No HUD-specific placeholder syntax.
   **A resolved value is inserted as text, never as markup**: its MiniMessage tags are escaped,
   so a guild or player name cannot bring a font, a negative space or a click. Only the template
   written by the admin carries tags. Legacy colour codes in a PAPI value are handled as the
   lore handles them.
3. **Refresh: change notices first, a tick as fallback.**
   - A HUD is rendered again for a player when `variable_changed` (§10) names a variable its
     `texts` or `when` read, and on join, pack load and reload.
   - What gives no notice (PAPI, a module that never calls `changed`) is caught by a fallback
     tick every `refresh` ticks. `refresh: 0` turns it off: notices only.
   - **One task per player**, on the player's thread (`Scheduler` port, Folia), walks all their
     HUDs; never one timer per HUD.
   - The **resolved values** (and `when`) are compared with the last ones **before** composing:
     unchanged, nothing is parsed, measured or sent. Composing (MiniMessage parse, widths,
     fonts) only happens on a change.
   - Cost to be measured before the batch is called done (target: 200 players × 3 HUDs at
     `refresh: 20` invisible in a tick profile). `when` runs at each fallback tick: a slow
     condition there is the admin's cost, as in a menu.
4. **Modules provide values, not HUDs.** A module that wants its state on a HUD declares module
   variables (§10) and calls `changed` when they move. ArtisanQuests declares `quests.tracked_*`
   (quest name, objective, progress, target, percent, and a boolean `quests.tracking`); the
   tracked-quest HUD becomes a plain `hud`. **A HUD bound to an interaction stays on
   `OverlayApi`**: a conversation page is a session (a list with a selected row, a speaker's
   images, a redraw per key press), not a standing display, and ArtisanConversations does not
   change. No `api.getHuds()` is added: no consumer needs it yet.
5. **Three lifetimes, one runtime, a property of the HUD.** **Permanent** (no `when`: a
   scoreboard, the money), **conditional** (`when`: "tracks a quest", "is in a PvP zone"), or
   **temporary**: a HUD with `enabled: false` shown by the action
   `show_hud: {hud, duration}` (`duration` in ticks, as `refresh`; absent = until
   `hide_hud: {hud}` or quit). `show_hud` passes no values: a temporary HUD reads variables like
   the others.
6. **Migration of `quest_hud`: a read fallback, no file rewritten.** Nothing converts files on
   the server's disk (only the server writes them, through a publication). Instead, as
   `module-settings-folder` §3 does:
   - once ArtisanQuests declares `quests.tracked_*`, its `quest_hud` kind declaration hands
     Artisan a reader that turns a `quest_hud/v1` file **into a `hud`**: `slot: boss_bar`,
     `when` = `quests.tracking`, layout kept, `{objective_name}` / `%objective_name%` read as
     `{var.quests.tracked_objective}`… The table lives in the add-on: the core knows no add-on's
     format (modules talk to it only through its registries). `quest_hud` shipped on 2026-11-28,
     so this fallback may also be dropped if no server published one;
   - that version of ArtisanQuests stops drawing the layer itself and keeps only its plain boss
     bar for a player whose `hasPack` is false; `tracking.bossbar.hud` keeps naming the file, by
     the same id, in either folder;
   - the editor lists the old file as a HUD; saving it writes `huds/<id>.yaml` on the draft and
     removes the old one, published with Deploy like any edit;
   - the fallback and the `quest_hud` kind are removed one version later.

## Prerequisite

**`OverlayApi.hasPack` is false for a Bedrock player.** Today `PaperOverlay.hasPack` only reads
`PackLoadTracker`, with no Bedrock test (`RuntimeAssembly.hasPack` has one); ArtisanConversations
tests Floodgate itself, `ArtisanTrackingHud` does not. Geyser is believed to answer a Java pack
with a success, to be confirmed; either way the contract is fixed in the core, before the kind.

## Next steps (each its own ADR, after a prototype)

### Corners: a text core shader

The boss bar and the action bar are centred and the server does not know the screen's width, so
a corner cannot be reached by an offset. A core shader that moves marked glyphs can.

**Known** (LocoUI's pack, read 2026-11-28):

- **Feasible, at the price of one overlay per Mojang break.** One pack with `overlays` by pack
  format, each with its shaders: 1.21.4 (46), 1.21.5 (55), 1.21.6+ (63–79), 26.1 (84–87),
  26.2 (88), 26.3 (89+). From 26.2 the files are `core/text.*`, `gui.*`,
  `position_tex_color.vsh`, no `rendertype_text`. Artisan's builder writes one format range
  without overlays today: overlays are the first piece of work.
- **Coexistence is solvable.** Their `rendertype_text.vsh` only imports a hook and calls it;
  other plugins' text shaders call that hook (BetterHud through its API, others through a merge
  done at pack build). For Artisan: an `artisan_hook_vertex()` include other packs can call, a
  merge at pack build when a known competing text shader is found in the host pack, otherwise a
  warning (console, editor). Being the last pack sent (several packs since 1.20.3) wins.
- **Marking.** Glyphs are identified by a horizontal pad far off screen whose offset is the
  element's index; RGB bits carry the payload, on a blue byte a drop shadow cannot have. The
  glyph's own colour is therefore not free: to be designed.
- **One boss bar per zone**, and before the pack loads the player sees those bars with missing
  characters: Artisan shows them only when `hasPack` is true.

**Decided now, so the kind does not paint itself into a corner:**

- **Position = an anchor + GUI-pixel offsets**: `slot` gains `top_left`, `top_right`,
  `bottom_left`, `bottom_right`, `top_centre`…; `layout` x/y stay GUI px, measured from the
  anchor. **Not a proportional canvas** (see *Rejected*).
- **One boss bar per anchored zone**, stacked by `priority` inside it as today.
- **A shader-drawn `panel` layer** (colour, opacity, radius, border, no texture) belongs to this
  step, with an image fallback where the shader is absent.
- **The sidebar stays an option for the right edge**: natively right-anchored (vertically
  centred), no shader. To weigh in that ADR against the cost of the overlays.
- **Dropped if** the prototype fails on vanilla or on common client setups; this ADR then says so.

### Bedrock: a second renderer of the same Document

Geyser carries the text but not the Java fonts nor core shaders. A Bedrock HUD is a panel of
`hud_screen.json` (JSON UI) in the Bedrock pack Artisan already builds for menus, fed by a marked
title or action bar text; JSON UI anchors are native. Known limits to settle in its ADR: another
plugin's title replaces the carrier, the Bedrock pack only reaches a player at their next
connection, JSON UI is not a stable API (Ore UI). Until then a Bedrock player sees no `hud`
(prerequisite above) and keeps any module fallback.

### Per-player look

Nothing HUD-specific: Artisan themes plus a Project variable the HUD reads (`when`, a colour in
a text). The same answer covers "the player turns a HUD off".

## Consequences

- One kind and one editor page for every standing HUD; the admin composes a HUD from any module's
  variables without the module shipping a HUD.
- API: a `Since` line in `api-surface.md` for the kind's presence, `show_hud` / `hide_hud` and
  the `hasPack` contract; ArtisanQuests declares its variables and raises `MIN_API_VERSION`.
  ArtisanConversations: no change.
- **A permanent boss-bar HUD holds one boss bar row for every player, all the time**: other
  plugins' boss bars are drawn about 19 px lower, and a bar shown before Artisan's pushes the HUD
  down (`Slot.BOSS_BAR`: bars stack in the order shown). Documented for admins; the anchored
  zones of the shader step remove the dependency on the row.
- The action bar is shared with every plugin that sends action bar messages: a HUD there flickers
  with them. The boss bar slot is the default.
- Yellow boss bars stay reserved (already true since API 1.13.0).
- The core knows one add-on format (`quest_hud/v1`) for one version.

## Open questions (what would change the decision)

- **Shader step**: how a glyph keeps its own colour once RGB bits carry the payload; which
  competing text shaders the build merges; whether Iris with a shader pack leaves GUI text alone
  (believed, not verified).
- **Sidebar vs shader** for the right edge: is the sidebar enough for a first delivery?
- **Bedrock carrier**: title or action bar, marker format, and whether a HUD change may wait for
  the next connection.
- **`refresh` bounds** (5..1200) and the performance target: to confirm by measure.
- **Several Projects** each shipping a `hud` into the same slot: stacking by `priority` handles
  it; is a server-wide list of active HUDs needed in the editor's Home?
- **`show_hud` with values** (`{arg.…}`): only if a real case appears that variables cannot carry.

## Rejected

- **Each module keeps its own HUD kind** (`quest_hud`, future `economy_hud`…): one kind per
  module, no mixing, the admin learns N editors for the same layout.
- **A generic `hud` whose slots each module declares** (named zones + module-specific
  placeholders): a declaration API that duplicates module variables.
- **Conversations as a temporary `hud`** (`api.getHuds().show(player, hud, values)`): a page
  needs a list, per-speaker images and a redraw per key press; `values` in texts carry none of it.
- **Converting `quest_huds/` on first start**: an add-on writing Project files outside a
  publication, and drafts left on the old kind.
- **A proportional canvas** (LocoUI: x/y on 1920×1080, as screen fractions): GUI px from an
  anchor are pixel-exact at every GUI scale and are what `OverlayLayout` already uses;
  proportional scaling is expected to distort pixel art off 16:9. That rationale is not yet
  verified on their output.
- **One engine in the shader** (LocoUI: a generated include of ~3300 lines, a table of 146
  elements, minimap markers): too big for the need. Artisan's shader only moves a zone to its
  anchor and draws panels; the layout stays in fonts.
