# Artisan — Minecraft GUI Editor Plugin

**Product spec — reference document for development and product decisions**
Version: draft 1 (April 2026)

---

## 1. Vision and positioning

### 1.1 Product vision

Let any Minecraft server admin create professional-quality custom interfaces (menus, GUIs), without pixel art skills, without juggling several plugins, and without writing YAML.

The admin composes interfaces visually from existing assets — vanilla images, packs bought on MCModels, or uploaded personal images — in a drag & drop web editor. The plugin automatically generates the required resource pack and config, and everything runs in game immediately.

### 1.2 Market positioning

The product is not a direct competitor to NxMenu. NxMenu targets pixel art designers who can create assets, and remains a tool for **artistic creation**. Our product targets the remaining 95%: admins who want good-looking menus but can't draw (and don't want to learn). It is a tool for **composition and configuration**, not graphic creation.

Against existing solutions on the market:

- **vs zMenu / DeluxeMenus**: a modern alternative where configuration is done visually instead of in YAML. The goal is mass adoption as the de facto standard for server menus.
- **vs Nexo / ItemAdder**: these are not direct competitors (Nexo and ItemAdder manage the game's custom items, not GUIs specifically). Our product coexists with them and can integrate with their ecosystem in v2.
- **vs NxMenu**: complementary positioning, not competitive. NxMenu for those who draw, our product for those who compose.

### 1.3 Key differentiation

The admin composes GUIs without pixel art, all in a modern web editor with live editing (the WS pushes changes in game instantly). The freemium model enables mass adoption; the paid tier captures value on advanced use cases (custom assets). Polished demo, real community, real public roadmap.

---

## 2. General architecture

### 2.1 Architectural pattern

The architecture follows a **hosted-edit / local-runtime** pattern:

- **Editor side**: web application hosted by us (e.g. `editor.artisanmc.net`). This is where admins configure their menus, manage their assets, and organize their teams.
- **Plugin side**: Spigot/Paper module installed on the admin's Minecraft server. It serves the menus to players, manages native inventories, and runs click actions. It works offline-first: no internet dependency in game. If the editor goes down, customers' servers keep serving their menus normally.

### 2.2 Data flow

```
[Admin]
   │
   │ 1. Edits via web (drag & drop)
   ▼
[Hosted web editor] ◄────── 2. Persistent WS ──────► [Minecraft plugin]
   │                                                       │
   │ 3. Generates bundle (config + resource pack)          │
   │                                                       │ 4. Serves menus
   ▼                                                       ▼
[CDN] ────── 5. Players download the pack ───────► [Player in game]
```

### 2.3 Three communication channels

- **Editor ↔ plugin WebSocket**: outbound connection from the plugin to the editor (no port to open, works behind NAT/firewall). Carries the draft (live editing), the "publish" command, and the sync at plugin boot.
- **HTTPS editor → CDN**: upload of the generated signed bundles (resource pack + config).
- **HTTPS player → CDN**: resource pack download when the player joins the server.

### 2.4 Operating modes on the plugin side

The plugin maintains two "flavors" of the same menu to allow non-disruptive editing:

- **Live (production)**: current version persisted on disk, served to all players. Independent of the WS — if the tunnel goes down, the live version keeps working.
- **Draft (live editing)**: what the admin is currently tinkering with in the editor. Visible only to them via `/menu preview <id>`. Near-instant re-render on every change through the WS.

A third **Staging** flavor (frozen preview available to invited testers via `menu.preview.<id>`) is planned for V1.5, when team workflows become a real use case.

---

## 3. Business model

### 3.1 Philosophy: a useful, complete free tier; Pro for texture hosting

**The free tier is useful, complete, and perpetual** — but requires an account (Discord OAuth in 1 click, or email/password). The free admin has access to **the whole visual editor and all design capabilities**: live edit + auto-sync, MiniMessage with preview, i18n, layers, conditional appearances, templates, commands, data sources and their connectors, native integration with **Nexo, ItemsAdder, Oraxen** for existing custom items, asset library. The Minecraft plugin (.jar) is free on SpigotMC and Modrinth. This is **already superior to zMenu and DeluxeMenus** on every axis (visual UX + features).

**A single paid tier: Pro.** A binary decision. Pro unlocks the **hosting and automatic management service for the custom resource pack**: you upload your PNGs in the editor, we compile them into a signed pack, host it on our CDN, and the plugin downloads and applies it. Without Pro, the admin is still free to use vanilla materials, their already-paid Nexo/ItemsAdder items, or their own self-hosted resource pack (via the native Spigot `resource-pack` feature).

**You don't charge for creativity — you charge for the hosting/management service** that you provide on top. This is the most honest angle possible.

**No artificial friction.** The free user has a complete, working product. The paywall appears **when they want the custom textures + CDN service** that you offer on top:

- **Auto-managed custom textures (PNG upload → signed CDN)**: free = ✗, Pro = ✓.
- **MCModels import (.zip parsing)**: free = ✗, Pro = ✓.
- **Multi-server**: free = 1 server, Pro = 5 servers (or more for +€1/month per extra server).
- **Cloud storage**: free = 500 MB, Pro = 50 GB.
- **Cloud version history**: free = 30 days rolling, Pro = unlimited with rollback to any date.
- **AI assistant (V1.5)**: free = ✗, Pro = 50 reqs/month (or standalone add-on).

This structure keeps solo creators as ambassadors (they style visually with Nexo/ItemsAdder + free Artisan, share on YouTube, and recruit new users), and captures revenue on the "real productive use" signals: wanting the all-in-one Artisan service (custom pack + multi-server + MCModels).

### 3.2 Pro tier

| | **Free** | **Pro** |
|---|---|---|
| Account required (Discord or email) | ✓ | ✓ |
| Visual editor + live preview | ✓ | ✓ |
| Live edit + auto-sync (cloud mode) | ✓ | ✓ |
| All editor features (appearances, layers, commands, i18n, MiniMessage, data sources, templates) | ✓ | ✓ |
| **Vanilla materials** (DIAMOND, EMERALD, etc.) | ✓ | ✓ |
| **Nexo / ItemsAdder / Oraxen integration** (via material namespace `nexo:item_name`, `itemsadder:item`, etc.) | ✓ | ✓ |
| Player heads via base64 / HEAD_DATABASE | ✓ | ✓ |
| Minecraft plugin (free `.jar` on Spigot/Modrinth) | ✓ | ✓ |
| Local mode (offline, opt-in) | ✓ | ✓ |
| **Custom textures upload + auto CDN pack management** | **✗** | **✓** |
| **Self-hosted resource pack + server-bound signature** | **✗** | **✓** |
| **MCModels import (.zip parsing)** | **✗** | **✓** |
| **Servers linked to the account** | **1** | **5** |
| Cloud storage (workspace) | 500 MB | 50 GB |
| Cloud version history, rollback | 30 days rolling | unlimited |
| AI assistant (V1.5) | ✗ | 50 reqs/month |
| Priority support | community Discord | priority Discord (reply <24 h) |
| **Annual** *(default at checkout)* | — | **€30/year** |
| **Lifetime** *(AI not included, see add-on)* | — | **€80** |

Indicative prices, to be recalibrated post-launch based on observed conversions.

Beyond 5 servers, **+€1/month per extra server** on Pro, or a negotiated Enterprise rate for 10+ servers.

#### Annual and lifetime push at checkout

At checkout, **only two options**: annual at €30/year (default) or lifetime at €80 (highlighted as *"Support the launch — never pay again"*). No monthly plan — it fragments the pricing too much for the MC market, which prefers annual or one-time payments. **30-day money-back guarantee** on both options.

#### AI Assistant add-on

For lifetime users who want AI, Pro users who exceed their monthly quota, or free users who just want AI without all of Pro:

- **Pay-as-you-go**: €2 = 50 AI credits, valid for life.
- **Standalone AI subscription**: €3/month = 150 reqs/month.

AI is not included in lifetime because a request costs ~€0.015 to €0.05 in Claude API fees — over 5+ years at 50 reqs/month, the marginal cost exceeds the value of the lifetime plan.

#### Founder rate (launch pricing)

During the **first 3 months post-launch** (extendable by 1 month if critical bugs delay adoption): **-30% on Pro, locked in for life as long as the subscription stays active**.

| Pro founder | Annual | Lifetime |
|---|---|---|
| | €21/year | €56 |

If the admin cancels and resubscribes later, they return to full price. Effect: urgency to sign up in the first 3 months, massive retention afterwards, a community of loyal early adopters.

### 3.3 Why this segmentation is honest and defensible

The free admin is **never creatively blocked**. Three ways to get visually custom menus without paying for Pro:

1. **Vanilla materials**: MC 1.21.4+ offers hundreds of vanilla materials, blocks, and items. More than enough to build clean, readable menus.
2. **Nexo / ItemsAdder / Oraxen**: these plugins (often ~€15-20 one-time) provide unlimited custom items. You integrate them into Artisan via `material: "nexo:custom_sword"` — the editor visualizes, the plugin resolves at runtime. **This integration is free** because these are their items, not yours.
3. **Self-hosted resource pack**: the admin compiles their own pack with OptiFine/MCPatcher/MCModels, hosts it on their web server, and pushes it to players via the Spigot `resource-pack` feature in `server.properties`. No need for Artisan for that.

Pro exists for admins who **want to avoid these 3 manual steps** and want Artisan to handle everything on autopilot: upload a PNG in the editor, we compile, sign, host, and distribute. It is a **productivity service**, not an artificial feature lock.

### 3.4 Special programs

**Creator program**: free Pro account for verified creators (>2k YouTube subs or >5k Twitter followers on Minecraft content). Creators make tutorials, reviews, and templates shared on Discord.

**Migration discount**: promo *"I'm coming from [zMenu / DeluxeMenus / other]"* → -50% for the first 6 months. Coupon visible on the landing page.

**Open source contributors**: free Pro account for significant contributors to the Artisan libs published as open source (MiniMessage parser, JSON schemas, Minecraft plugin under MIT).

**Public demo without signup**: `artisanmc.net/playground` — a live editor that loads an example menu, without login. Massive driver toward free signup.

### 3.5 Personas served

- **Free, vanilla hobby admin** (1 server, vanilla materials): stays free, YouTube/Discord ambassador. Cost to us = ~0.
- **Free, RPG/medieval with Nexo/ItemsAdder** (1 server, custom items via third-party plugin): seamless workflow via material namespace. Cost to us = ~0 (the pack comes from their third-party plugin).
- **Pro, custom textures without a third-party plugin** (1-5 servers, wants the Artisan all-in-one): **core target**. €30/year is the equivalent of a coffee every 2 months, and they get automatic management on top.
- **Pro, MCModels import**: they bought a €30 pack, +€30/year (or €80 lifetime) to use it visually with the editor = trivial.
- **Pro, multi-server**: public MC networks with multiple game modes.
- **Lifetime buyers**: anti-subscription. Break-even vs annual at ~2.5 years.

### 3.6 Concrete conversion triggers

- Free user uploads their first PNG in the editor → *"Custom textures + auto CDN requires Pro (€30/year or €80 lifetime, founder rate -30% for the first 3 months)."*
- Free user buys an MCModels pack and tries to import it → *"MCModels import requires Pro."*
- Free user installs on a 2nd server → *"Pro unlocks up to 5 servers."*
- Free user exceeds 500 MB storage → *"Pro unlocks 50 GB."*
- Free user wants to roll back to a menu from 2 months ago → *"Version history > 30 days requires Pro."*
- Free user wants the AI assistant (V1.5) → upgrade to Pro or standalone AI add-on.
- Annual tier by default at checkout: *"Pro annual: €45 (save €15/year vs monthly)"*.
- Pricing page: Lifetime option highlighted ("Support the launch — €80, never pay again").

### 3.7 Anti-cracking and account sharing

Minimalist approach, aligned with the "we charge for the service, not the usage" philosophy:

- **Validation at sync (cloud mode only)**: the plugin pulls a bundle, the editor validates the server key and refuses if it is already used by another server (IP+port+motd fingerprint).
- **Server-bound signature**: each Pro bundle contains a signature that is valid only for the target server key.
- **Local mode requires no validation**: it is free, no need for anti-crack.
- **Free → Pro → Free downgrade**: if the admin cancels Pro, their auto-pack is disabled and their extra servers (slots 2-5) lose editor access. But **existing menus keep working** (the plugin has already downloaded the bundle and keeps serving it to players). The admin can edit on free (vanilla + Nexo) or resubscribe to get custom textures back.

**On account sharing / multi-accounts to bypass the quota**: we **let it slide in V1**. The natural friction (fragmented workspaces, no menu/asset/texture sharing across accounts, no cross-device on the same workspace, no MCModels) makes bypassing more annoying than paying. **We watch the post-launch data and tighten if necessary**.

---

## 4. Editing system (unified mode with progressive disclosure + JSON)

### 4.1 Principle: a single mode, progressive complexity

No "Visual / Advanced" toggle. A unified editor that puts simple actions up front and exposes advanced capabilities through "+ Add X" buttons and expandable sections. Inspiration: Notion (slash commands), Linear (inline filters and options), Figma (nested panels). Clean interface by default, everything accessible in one click.

Benefits:

- **Discoverability**: the "+" buttons themselves serve as implicit docs ("oh, I can add a cooldown here").
- **No friction**: no "switch to do X". Smooth workflow for novices and power users.
- **Simple architecture**: no mode state to manage, a single DOM tree with collapsible sections.

### 4.2 Disclosure hierarchy

For each slot, the properties panel exposes:

- **Always visible**: appearance (asset / material, title, lore, count) and the main click action (left click + its sequence of atomic actions).
- **Visible but discreet ("+ Add X" buttons)**: add a condition / a cooldown / a fallback / another click type / a conditional state / tags. Each "+" exposes the appropriate form inline.
- **Auto-displayed when relevant**: third-party component section (if the slot references a `component_ref`), template section (if it is an instance), error badges (missing asset, unavailable component, etc.).
- **Universally accessible**: variables and placeholders available via autocomplete in any text field (title, lore, action message) — no need to enable a mode.

Expanded sections are remembered per account/menu: an admin who always works with conditional appearances open finds them open when opening the editor.

### 4.3 Extensibility — JSON Export/Import + AI

No embedded code editor in the UI. Power users who want to manipulate the format directly use three complementary capabilities:

- **JSON export**: downloads the current menu as `.json`. Useful for sharing, Git versioning, external manipulation.
- **JSON import**: upload of a `.json` strictly validated against the versioned schema. Replaces the current draft.
- **View raw JSON**: read-only modal with copy-to-clipboard and deep links to external AIs (V1.5+).

**AI-native philosophy**: in 2026, the natural "code" interface for a power user is no longer a YAML editor, it is an AI. An admin who wants a complex change describes their intent to Claude/GPT and copy-pastes the resulting JSON. The JSON schema is treated as a central product asset:

- Versioned (`menu/v1`, `menu/v2`...) with migrations applied at load.
- Documented as TypeScript types + JSON Schema, published at `docs.artisanmc.net/schema`.
- Annotated examples for common patterns (simple shop, paginated with third-party component, conditional appearances, etc.).
- Stable and explicit (verbose field names: `requirements` rather than `req`).

This approach massively simplifies the architecture (no bidirectional sync to maintain) and opens a progressive AI integration roadmap: built-in AI assistant in V1.5, MCP server in V2 for Claude Desktop / Cursor / etc.

### 4.4 Multi-menu canvas (V1)

In addition to the detailed menu editor (zoomed in on one menu), the editor exposes a Figma-style **multi-menu canvas** mode: an infinite space where each menu appears as a preview card, and `open_menu` actions turn into automatic arrows between cards. It lets you see and manipulate a server's whole navigation structure at a glance.

Use cases:

- **Overview**: see all of a server's menus, their links, and orphans (unreferenced menus).
- **Direct link manipulation**: drag an arrow from a button to a target menu instead of typing its `menu_id`.
- **Spatial memory**: organize menus visually (shops on the left, navigation in the center, admin tools at the bottom).
- **AI synergy (V1.5+ for the built-in assistant)**: *"add a profile menu and link it from main_menu"* → the AI creates the data, the editor auto-lays out the new card. The AI never does spatial placement itself — that is the layout engine's job. The canvas is available in V1, the AI assistant plugs into it in V1.5.
- **Foundation for the MCP server (V2)**: the canvas view and the MCP server expose the same graph data in two forms (visual vs structured), with no duplication.

**Planned implementation**: React Flow for the canvas (the 2026 standard for node-based editors). Each menu = a custom node rendered as an inventory preview. Each `open_menu` action detected in any Element = an auto-generated edge (never stored, always derived).

**Storage**: each menu's (x, y) position on the canvas is stored on the workspace backend side (`workspace_layout` table), not in the menu JSON. It is UX state, not runtime. Menus stay portable without this info — at worst, auto-layout repositions everything on import.

### 4.5 Copy/paste — identity rules

For copy-paste operations in the editor:

**Element copied within the same menu**: new auto-generated `id` (suffix `_2`, `_3`, etc.). The `cooldown.id`s inside are also renamed so they don't share cooldowns with the original.

**Element copied into another menu**: keep the original `id` unless it collides with an existing Element in the target. On collision → auto-rename as above. The `pagination_*.element_id` references inside the copied content that point to other Elements of the *same source menu* become dangling after the paste — the editor warns and offers a fix.

**Element copied onto the empty canvas**: rejected. An Element needs a target menu. The orphan exists only in the editor's clipboard (transient in-memory state), never in persisted data.

**Whole menu copied within the workspace**: new auto-generated `menu.id` (`shop_main` → `shop_main_2`). All Element ids inside are kept (menu scope). The `open_menu` actions *inside* the copied menu stay unchanged (the admin most likely wanted the same internal navigation structure). The `open_menu` actions *from other menus* that pointed to the source menu are not auto-redirected to the copy.

**Command copied within the workspace**: new auto-generated `id`, and the `name` gets a `_2`/`_3` suffix to avoid a conflict (the admin renames before publish).

### 4.6 Command editor

Commands (see section 15) have their own editor in the dashboard, accessible via the "Commands" tab of the current pack. No slot canvas, no inventory — just a structured form: metadata (name, aliases, permission, description), argument list with a drag handle to reorder, requirements + actions + fallback editable with the same widgets as the menu click handlers (reuse of the `<ActionsEditor>` React component).

The multi-menu canvas (section 4.4) shows commands as distinct nodes (dedicated shape and color), with an arrow to the menu they open (if any).

---

## 5. Action catalog

### 5.1 Atomic actions (MVP)

15 actions at launch, covering ~95% of shop / menu / admin use cases:

| Action | Parameters |
|---|---|
| `run_command` | command (string), as (`player` / `console`) |
| `open_menu` | menu_id, optional close_current (bool), optional context (Record<string,string> overriding the auto-binding), optional clear_context (bool — disables the auto-binding, see §15.4) |
| `close_menu` | — |
| `give_item` | material, count, optional nbt, optional name, optional lore |
| `take_item` | material, count, optional nbt match |
| `give_money` | amount, optional currency (Vault) |
| `take_money` | amount, optional currency (Vault) |
| `give_xp` | amount |
| `give_level` | amount |
| `send_message` | text (with placeholders) |
| `broadcast` | text (server-wide) |
| `play_sound` | sound, volume (0-1), pitch (0-2) |
| `teleport` | location (world + x/y/z + yaw/pitch) or warp_name |
| `pagination_next` | optional element_id (auto-bind if there is a single paginated list in the menu) |
| `pagination_prev` | optional element_id (auto-bind if there is a single paginated list) |

### 5.2 Conditions (layer 2)

| Condition | Description |
|---|---|
| `has_permission` | perm string |
| `has_money` | amount, optional currency |
| `has_item` | material, count, optional nbt match |
| `has_xp` | amount |
| `has_level` | minimum level |
| `placeholder_equals` | placeholder, value |
| `placeholder_match` | placeholder, regex |
| `cooldown_passed` | cooldown_id |
| `world_is` | world name |
| `time_is` | range (`day`, `night`, or custom ticks) |
| `random_chance` | probability (0-1) |
| `player_in_region` | region (if WorldGuard is detected) |
| `pagination_at_first` | optional element_id — useful to gray out a "prev" button via a conditional appearance |
| `pagination_at_last` | optional element_id — useful to gray out a "next" button via a conditional appearance |
| `not` | wraps a condition |
| `and` / `or` | condition composition |

### 5.3 Requirements and fallback

A click action chain can specify:

- `requirements`: list of conditions (ANDed by default) to check before execution.
- `actions`: to run if all requirements pass.
- `fallback`: to run if a requirement fails (by default a "you can't do that" message).
- `cooldown`: id + duration + scope + custom message if on cooldown.

### 5.4 Variables (v2)

Deferred to v2. In the meantime, we rely on PlaceholderAPI and its extensions for counter / dynamic progress use cases. The spec structure does not preempt their addition: a `set_variable` action and `variable_equals` / `variable_match` conditions will be added naturally.

---

## 6. Conditional appearances + Layers

### 6.1 Appearances model

An Element has a list of `appearances`, each **complete and self-sufficient** (no inheritance between them). The engine evaluates appearances in order: the first one whose `if` matches (or whose `if` is absent = implicit match) wins and is rendered. If **none matches** → the Element is not rendered, falling through to the layer below.

No separate "default vs state" notion: it is a uniform list of variants. An appearance without `if` serves as the fallback (to be placed last in the list).

### 6.2 Layers

The menu is organized into **layers** ordered bottom → top. At render time, the engine walks the layers from top to bottom for each position: it takes the first Element that renders something. This enables the *"conditional button + decoration underneath"* pattern: if the button has no matching appearance, the decoration layer takes over.

The editor shows a layer panel (Photoshop / Figma style) with an eye toggle and a lock per layer (UI-only, does not affect in-game rendering). A trivial menu has a single "default" layer, auto-created, and the layer panel stays collapsed — the novice admin doesn't see the complexity.

### 6.3 Refresh

Appearances are re-evaluated:

- When the menu opens.
- After every click in the menu (to immediately reflect the post-action state).

No periodic refresh in the MVP (CPU cost). Continuous refresh for dynamic progress bars will be a v2 feature.

### 6.4 Click in an appearance

- Appearance with `click` defined → clickable according to the ClickMap.
- Appearance with `click: null` → explicitly non-clickable (readability).
- Appearance without `click` (undefined) → non-clickable.

### 6.5 Example

```json
{
  "id": "btn_rank_vip",
  "positions": "15",
  "appearances": [
    {
      "if": [{ "type": "has_permission", "perm": "rank.vip" }],
      "asset": "rank_vip_owned.png",
      "title": "§6VIP Rank",
      "lore": ["§aAlready owned"],
      "click": null
    },
    {
      "if": [{ "type": "not", "of": { "type": "has_money", "amount": 500 } }],
      "asset": "rank_vip_disabled.png",
      "title": "§6VIP Rank",
      "lore": ["§cYou don't have enough money"],
      "click": null
    },
    {
      "asset": "rank_vip_button.png",
      "title": "§6VIP Rank",
      "lore": ["§7Price: §a500$", "", "§eClick to buy"],
      "click": {
        "left": {
          "requirements": [{ "type": "has_money", "amount": 500 }],
          "actions": [
            { "type": "take_money", "amount": 500 },
            { "type": "run_command", "command": "lp user %player_name% parent set vip", "as": "console" },
            { "type": "send_message", "text": "§aVIP Rank unlocked!" }
          ],
          "fallback": [{ "type": "send_message", "text": "§cNot enough money" }]
        }
      }
    }
  ]
}
```

Three appearances evaluated in order. The last one (without `if`) serves as the fallback. The JSON is a bit more verbose than a partial override, but each appearance is complete and readable in isolation.

---

## 7. User-defined templates (Symbols)

### 7.1 Concept

Inspired by "symbols" in Figma or "blocks" in WordPress. The admin saves a configured slot under a name (e.g. `bouton_acheter`). They can reuse it in any menu, and any change to the template propagates to all its instances (with confirmation).

### 7.2 Typed variables in templates

To enable real reuse, templates support typed variables:

```json
{
  "schema": "template/v1",
  "template_id": "bouton_acheter",
  "variables": [
    { "name": "prix", "type": "number" },
    { "name": "item_material", "type": "material" },
    { "name": "item_name", "type": "string" }
  ],
  "appearances": [
    {
      "asset": "buy_button.png",
      "title": "Buy {{item_name}}",
      "lore": ["§7Price: §a{{prix}}$"],
      "click": {
        "left": {
          "requirements": [{ "type": "has_money", "amount": "{{prix}}" }],
          "actions": [
            { "type": "take_money", "amount": "{{prix}}" },
            { "type": "give_item", "material": "{{item_material}}", "count": 1 }
          ]
        }
      }
    }
  ]
}
```

### 7.3 Local override

When instantiating a template in a menu, you provide the variable values. You can also, optionally, **locally override** fields (e.g. lore added for this instance only). The UI clearly distinguishes:

- "Template edit" → propagates to all instances (with a confirmation).
- "Local override" → changes only this instance.

### 7.4 Detaching

An admin can "detach" an instance from a template (equivalent to Figma's "Detach symbol"). The instance becomes a standalone slot that can be edited freely, with no more propagation from the template.

---

## 8. Intermediate format (JSON)

### 8.1 Principles

- **Versioned** from the start (`"schema": "menu/v1"`) with migrations applied at load.
- **Single source of truth**: a menu's whole state is in its JSON. No separate derived data.
- **Human-readable**: a power user should be able to understand and edit in Code mode without documentation.
- **Layers + id-indexed Elements**: a menu contains Layers (ordered containers, bottom→top), each containing Elements. Each Element has a stable `id` and occupies one or more Minecraft positions via `positions`. At render time, the engine walks the layers from top to bottom and takes the first visible Element at each position.
- **Uniform appearances**: each Element has a list of `appearances`, each complete and self-sufficient. The first one whose `if` matches wins. If none matches → fall-through to the next layer.
- The term "slot" in sections 4–7 informally refers to an Element; the formal name in the schema is **Element**.

> The full schema (JSON Schema Draft 2020-12 + TypeScript types + 5 annotated examples + design README) lives in [`docs/schema/menu/v1/`](../schema/menu/v1/) and is the validatable source of truth. This section remains a summary for reading.

### 8.2 Top-level schema of a menu

```json
{
  "schema": "menu/v1",
  "id": "shop_main",
  "title": "Main shop",
  "size": 27,
  "permission": "menu.shop.open",
  "background": { "asset": "shop_bg.png" },
  "open_requirements": [...],
  "open_actions": [...],
  "close_actions": [...],
  "layers": [
    {
      "id": "decoration",
      "name": "Decoration",
      "elements": [
        { "id": "deco_top_row", "positions": "0-8", "appearances": [...] }
      ]
    },
    {
      "id": "items",
      "name": "Items",
      "elements": [
        { "id": "btn_diamond_sword", "positions": "11", "appearances": [...] },
        { "id": "btn_rank_vip",      "positions": "15", "appearances": [...] },
        { "id": "btn_close",         "positions": "22", "appearances": [...] }
      ]
    }
  ],
  "metadata": { "uses_plugins": ["questx"] }
}
```

### 8.3 Schema of an Element

```json
{
  "id": "btn_buy",                // required, unique within the menu (cross-layer)
  "positions": "15",               // required, "15" or range "10-43"
  "appearances": [                 // required, at least one, first match wins
    {
      "if": [...],                 // optional; if absent = always matches (fallback, to be placed last)
      "asset": "image.png",        // optional
      "material": "DIAMOND",       // optional
      "count": 1,
      "title": "Title",
      "lore": ["line 1", "line 2"],
      "enchanted": false,
      "custom_model_data": "...",  // CMD string 1.21.4+
      "component_ref": "questx:quest_button",  // optional, third-party component
      "click": {
        "left":  { "requirements": [...], "actions": [...], "fallback": [...], "cooldown": {...} },
        "right": { ... },
        "shift_left": { ... },
        "shift_right": { ... },
        "middle": { ... }
      }
    }
  ],
  "template_ref": null,           // or { "id": "...", "vars": {...}, "overrides": {...} }
  "tags": ["shop", "premium"]     // for search/filter in the editor
}
```

### 8.4 Render semantics

For each position 0 to `size-1`, the engine:

1. Walks the layers from **top to bottom** (`menu.layers` read in reverse order — last in the list = top)
2. For each layer, identifies the Element that claims this position (last-placed-wins on intra-layer overlap)
3. Evaluates the `appearances` in order. First one whose `if` matches → render at this position, slot done
4. No appearance matches → fall-through to the next layer
5. No layer provides a rendered Element → render `menu.background` if defined, otherwise an empty position

### 8.5 Migrations

A `migrations.json` file on the plugin side lists the applicable migrations. When loading a menu:

```
read schema_version
while schema_version < latest:
  apply migration[schema_version → schema_version + 1]
  schema_version += 1
```

Migrations are versioned and tested. A v1 menu remains readable by a v3 plugin (migrations are applied on the fly).

---

## 9. Resource pack generation

**Note**: automatic resource pack generation + its hosting on the Artisan CDN + its server-bound signature is a **feature gated on the Pro tier** (see section 3). Free users have three alternatives: (1) vanilla materials only, (2) native integration with their Nexo/ItemsAdder/Oraxen items via material namespace, (3) self-hosting their own resource pack via the native Spigot `resource-pack` feature. Everything below describes the Pro auto-pack pipeline.

### 9.1 Technical target

Minecraft **1.21.4+** only. This decision enables:

- The use of `custom_model_data` as a string (`"artisan:button_buy"`), avoiding any namespace conflict with Nexo, ItemAdder, or any other pack.
- Pack stacking (since 1.20.3+), which lets several resource packs coexist. Our generated pack coexists without friction with those of other plugins.

### 9.2 Rendering mechanisms

Two techniques combined:

- **Custom items (CMD strings)**: for each slot with a custom asset, we generate an item model tied to a unique CMD string. The slot displays a vanilla item (paper, stick) with this CMD. The client resolves the model via the pack.
- **Custom fonts**: for decorative elements and backgrounds (which we overlay in the menu title), we define named custom fonts (`artisan:menu_overlay`). Each character is mapped to an image. This allows several visual elements to be overlaid in a single title area.

### 9.3 Structure of the generated pack

```
pack/
  pack.mcmeta
  assets/
    artisan/
      textures/
        items/<asset_name>.png
        font/<font_glyphs>.png
      models/
        item/<item_id>.json     # model referenced by CMD string
      font/
        menu_overlay.json       # custom font
        decorations.json
```

### 9.4 Generation pipeline

```
1. Admin's asset library (uploads + MCModels imports)
   ↓
2. Normalization (resize to the nearest multiple of 16, info popup if non-conforming)
   ↓
3. CMD string allocation (deterministic: artisan:menu_<menu_id>_<slot_id>)
   ↓
4. JSON model generation
   ↓
5. Font generation for overlays
   ↓
6. .zip packaging + server signature
   ↓
7. Upload to the CDN (URL returned to the plugin)
```

### 9.5 Hosting

- **Editor CDN (default)**: the .zip bundle is uploaded to our CDN, and the plugin sends the URL to players (`server.send_resource_pack(url)`). Fast, reliable, no port to open on the admin's server.
- **Plugin self-host (fallback)**: option in `config.yml`. The plugin serves the pack via a small local HTTP server. For admins who want full autonomy or who are on corporate networks. Document the port forwarding / reverse proxy considerations.

### 9.6 Asset management

- **Auto normalization**: on upload, the image is resized to the nearest multiple of 16 (16, 32, 64, 128px). A popup informs the admin of the transformation, with a before/after preview. "Don't show again" toggle for power users.
- **Validation**: only PNG is accepted. JPG is refused (destructive compression, incompatible with overlays). Per-file limit: 256 KB normalized, 2 MB pre-normalization.
- **Quota limits** per tier (see section 3.2).

---

## 10. Displayed text format (MiniMessage + i18n)

All text fields in menus and commands (titles, lores, messages, command descriptions, etc.) follow a unified content convention that combines **MiniMessage** for formatting and **i18n** for translation.

### 10.1 MiniMessage format (Adventure / Paper)

Text fields are stored and rendered in **MiniMessage**, the standard text format of Adventure and Paper since 2022. An XML-like tag format, much more powerful and readable than legacy `§a` codes:

```
<gold><bold>Shop</bold></gold>
<gradient:#a8e063:#56ab2f>Welcome, %player_name%!</gradient>
<click:run_command:'/heal'><yellow>Click to heal</yellow></click>
```

Tags supported at runtime (by Adventure): named colors (`<red>`), hex colors (`<color:#ff00aa>`), modifiers (`<bold>`, `<italic>`, `<underlined>`, `<strikethrough>`, `<obfuscated>`), `<reset>`, `<rainbow>`, `<gradient>`, `<click>`, `<hover>`, `<insertion>`, `<keybind>`, `<lang>`, `<font>`, `<newline>`. Documentation: https://docs.advntr.dev/minimessage/format.html

**Legacy `§a` / `&a` codes**: accepted as input (the admin pastes a message from another plugin) but **converted to MiniMessage on save** (canonicalization on the backend, idempotent). Opt-out available in the workspace settings to keep legacy.

### 10.2 MiniMessage editor with live preview

The editor provides a `<MiniMessageEditor>` component reused for all text fields:

- **Inline toolbar**: B/I/U/S, color picker (MC palette + custom HEX), "gradient" button, `{i18n:key}` insertion, PAPI placeholder insertion.
- **Edit field**: textarea with light syntax highlighting of tags (the `<...>` colored in gray monospace style).
- **Live preview** debounced ~50 ms: HTML rendering + Minecraft-like font (Open Source, ~30 KB), dark transparent background in inventory tooltip style. This is what the player will see.
- **Tag autocomplete** when you type `<`: filtered list of MiniMessage tags with a doc tooltip.

Single-line (title) and multi-line (lore = list of lines, each line is a MiniMessageEditor) variants.

**Implementation**: native React component, TS-native MiniMessage parser (~500 lines), bundled Minecraftia or similar OSS font. Adventure-webui (PaperMC, MIT) serves as a **visual reference** but we don't iframe it — full integration with our state for i18n key and placeholder autocomplete.

### 10.3 Internationalization (i18n)

**An i18n key** = a translatable text scoped to the admin's workspace. Referenced in any text field via the inline syntax `{i18n:menu.shop.title}`, freely mixable with MiniMessage and PAPI placeholders.

```json
"lore": [
  "{i18n:btn_diamond.lore.line1}",
  "<gray>Price: <yellow>%vault_eco_balance%</yellow> coins</gray>",
  "{i18n:btn_diamond.lore.warning}"
]
```

Keys live at the **workspace** level (not per pack or per menu), stored on the backend and exported as JSON conforming to `translations/v1`. Full schema: `docs/schema/translations/v1/`.

### 10.4 Key model

- Hierarchical slug with `.`: `menu.shop_main.btn_buy.title`, `command.profile.description`, `common.errors.no_perm`.
- Validated by regex: `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$`.
- A flat `keys[key][language] = MiniMessage value` map, O(1) lookup.
- A key must have at minimum the value in the workspace's `default_lang`.

### 10.5 i18n editor UX

On any text field, two entry points to insert or create a key without leaving the context:

- **`{` key** triggers a fuzzy autocomplete on the workspace keys. Selection → insertion of `{i18n:key}`.
- **`</>` button** on the right of the field opens a popover with search + a "+ New key" button.

**Auto-extract of existing text**: you type "Boutique" in the title field, you click "+ New key". The editor (1) creates the key `menu.shop_main.title` with FR value = `"Boutique"`, (2) replaces the field content with `{i18n:menu.shop_main.title}`, (3) opens a mini-modal to add other languages. No navigation to another screen.

**Editing an existing key**: click on the highlighted key in the field → mini-modal with the values per language and a MiniMessage live preview next to it.

**Detaching**: replaces `{i18n:key}` with the current value in plain text. The key stays in the workspace for other uses.

**Uniqueness validation** at creation time, live red indicator if it collides with an existing key.

### 10.6 Auto-generation of candidate keys

The `generateAutoKey(ctx)` helper (see `translations/v1/types.ts`) suggests a slug based on the editing context:

| Context | Candidate key |
|---|---|
| Title of menu `shop_main` | `menu.shop_main.title` |
| Lore line 1 of button `btn_buy` in menu `shop_main` | `menu.shop_main.btn_buy.lore.1` |
| Description of command `profile` | `command.profile.description` |
| Cooldown message `heal_cmd` | `cooldown.heal_cmd.message` |

If the key already exists, an automatic `_2`, `_3`... suffix is added.

### 10.7 Determining the player's active language

Three modes configurable in `config.yml` on the plugin side:

| Mode | Behavior |
|---|---|
| `server_default` | The whole server speaks a single language (the workspace's `default_lang`, config override possible). |
| `per_player_locale` *(recommended)* | Language derived from `Player#locale()` (Minecraft client locale). Mapped to the closest workspace language, falling back to `default_lang` if the translation is missing. |
| `per_player_placeholder` | Language derived from a custom PAPI placeholder (e.g. `%player_lang%` if the admin already has a `/lang` command via another plugin). |

The plugin loads all translations into memory at sync (the bundle's `i18n/<lang>.json` files). O(1) lookup cache when a menu opens.

### 10.8 Resolution order at runtime

When a menu opens or a command runs, each text field goes through the chain:

1. **i18n resolution**: `{i18n:key}` → value stored for the player's active language. Fallback to `default_lang` if missing. Fallback to empty text + log warning if also missing in default.
2. **PAPI resolution**: `%player_name%`, `%vault_eco_balance%`, etc. (placeholders from the third-party PlaceholderAPI engine).
2bis. **contextInputs resolution**: `{name}` and `{alias.field}` → values from the menu context (see §14, §15.4): propagated command args, values passed by the parent menu, current iteration items, data fetched by connectors.
3. **MiniMessage parsing**: tags → final Adventure Component sent to the client via Paper.

Consequence: a **translation can itself contain** placeholders and MiniMessage tags. A direct text (without `{i18n:...}`) simply skips step 1.

i18n resolution depth limit = 10 (safety against circular references).

### 10.9 Why not vanilla Minecraft's `translatable_key`

It is tempting to use Minecraft's native translation system (`assets/<ns>/lang/<locale>.json` in the resource pack, resolved client-side). We prefer **server-side**:

- **Language choice**: we can force the language (`server_default`) or derive it from a placeholder (`per_player_placeholder`), not only from the client locale.
- **Composition with PAPI**: placeholders are resolved server-side with the player context. With vanilla translatable_key, it is impossible to mix dynamic placeholders (`%vault_eco_balance%`) with a translation.
- **Debug and logs**: we log missing keys server-side, easier to diagnose.
- **No dependency on the resource pack reload** client-side when a language is added.

Accepted trade-off: we lose native translation of vanilla items (but we don't need it — our custom items are CMD strings that we control).

### 10.10 Workspace scope + pack import

Keys live at the workspace level. On **export** of a `.itfz` pack, we recursively compute (`extractI18nRefsDeep`) the union of the keys referenced by the pack's menus and commands, and embed this subset as `translations.json` at the root of the archive.

On **import** into another workspace, we merge with conflict handling (see `pack/v1/README.md`):

- Key absent locally → added.
- Key present, identical values → ignored.
- Key present, different value → conflict, 3-way dialog: *Keep local*, *Overwrite*, *Rename the imported key* (auto-prefix `pack.id`). Default = rename.

No key sharing between workspaces of different admins (each admin has an isolated namespace).

### 10.11 Pricing

i18n keys have **no quota** in any tier. Negligible storage (~a few KB per workspace), O(1) runtime on the plugin side. Not part of the paid axes (see section 3).

---

## 11. Live / Draft workflow

**Note**: this workflow applies to **cloud mode** (the default, all Free + Pro tiers). In **local mode** (opt-in, offline, all tiers), the plugin reads the JSON files from `plugins/Artisan/menus/`, and the editing cycle boils down to: edit in the web editor → export → upload to the server → `/artisan reload`. No Live/Draft distinction on the plugin side (live data = the data present on disk). The web editor keeps a local draft in the browser (auto-save), but no notion of "publish to live" makes sense without a WebSocket.

### 11.1 Editing cycle

```
[Admin opens an existing menu in the editor]
              │
              ▼
[Draft initialized = mirror of Live]
              │
              ▼
[Admin edits: drag, change asset, add condition...]
              │
              │  (each change → diff → WS → plugin updates the draft)
              ▼
[Plugin keeps a draft in memory, distinct from live]
              │
              ▼
[Admin tests: /menu preview shop_main → sees the draft in game]
              │
              ▼
[Admin satisfied → clicks "Publish"]
              │
              ▼
[Plugin receives the order, archives the old live, writes the new bundle, switches over]
              │
              ▼
[Players see the new version]
```

### 11.2 Multi-admin soft-lock

If two admins open the same menu in the editor at the same time:

- The first gets control (can edit).
- The others see it read-only with an "@admin1 is editing" indicator.
- "Take over" button available to take control (with confirmation).

No Figma-style collaborative editing in the MVP (operational transforms = a project in its own right). To be considered in v3 if demand is strong.

### 11.3 Archive and rollback

Each publish automatically archives the old live. We keep the **last 5 versions** per menu. "Rollback" button in the editor, accessible from the menu history. Rollback = re-publish of an archived version (without losing the intermediate versions, which stay in the history).

### 11.4 Draft persistence

- **Web editor side**: autosave to the editor server every 10 seconds after a change, plus browser localStorage as a backup. If the browser crashes, the admin gets their draft back.
- **Plugin side**: if the WS goes down while the draft is active, the plugin keeps its draft in memory for N minutes (configurable, default 30 min) then purges it. Live is never affected.

### 11.5 WS reconnection

The plugin maintains an outbound WS to the editor. On disconnect:

- Exponential reconnection (1s, 2s, 4s, 8s, 16s, max 60s).
- On reconnect, a handshake that includes the hash of the last bundle received. If the editor has a more recent bundle, automatic sync.
- While the WS is down: live keeps serving, the draft stays in memory (for the configured duration), no panic on the admin side.

---

## 12. Library (assets, menus, commands, templates) and organization into packs

### 12.1 Asset sources

- **My uploads**: what the admin uploaded manually. Multiple drag & drop supported.
- **Imported**: what we extracted from external packs. Drag & drop an MCModels .zip → the editor parses it, extracts the images, and organizes them in a folder tagged `MCModels: <PackName>`.
- **Marketplace** (v2): assets/menus bought via the native marketplace, imported in one click.

### 12.2 Organization

- **User-created folders** (e.g. `/shop`, `/quests`, `/lobby`).
- **Tags** (`button`, `icon`, `background`, `decoration`, `premium`...).
- **Search** by name + tag with combinable filters.
- **Grid preview** with filters (size, date, used in / unused).
- **Metadata**: dimensions, upload date, number of uses in menus.

### 12.3 Drag & drop in menus

From the asset library, the admin drags an asset directly onto a slot of the menu editor. The asset is linked to the slot by reference (path), not copied. A change to the asset propagates to all slots that use it.

### 12.4 Duplicate detection

On upload, an MD5 hash is computed. If the asset is already present (same hash), we ask the admin whether to overwrite, duplicate, or ignore. Avoids the accumulation of copies.

### 12.5 Cleanup of unused assets

"Unused assets" view that lists assets never referenced in any menu. "Delete unused" button (with confirmation). Helps stay under the storage quota.

### 12.6 Workspace and packs

The admin's workspace is organized into **packs**: thematic groups that together contain menus + commands + templates + related assets. A pack answers the question *"what goes together?"* — typically, the shop system fits in one pack (with its `/shop`, `/buy` commands), the main navigation menus in another, a pack bought from a creator in a third.

Each admin has a default **Personal** pack, auto-created, where everything they create lands until they explicitly assign it to another pack. They can create as many additional packs as needed, each with its own name and description.

The dashboard shows packs as collapsible sections. Content is nested inside by category: `📦 Shop System (5 menus, 2 commands)`, `📦 Daily Quests — bought from @creator-x v2.1.0 (8 menus, 1 command)`, etc. Creating a new menu or command asks the admin which pack to put it in.

### 12.7 Pack source: user-created, imported, forked

Each pack has a `source` that determines its behavior regarding updates:

- **user_created**: created locally by the admin. Free editing, never overwritten.
- **imported**: imported from a `.itfz` archive (purchase, Discord share, MCModels). Linked to a `source_pack_id` and a `source_version`. Re-importing the same source pack **overwrites all its content in bulk** — no migration, no merge, no three-way. Local changes are lost. The admin sees a clear warning dialog.
- **forked**: an imported pack that the admin forked to customize durably. From the fork on, behavior is identical to user_created (never overwritten) but we keep the `source_pack_id` as metadata for traceability.

The pattern is deliberately simple. Fork = "I take it, I customize it, I lose the upgrade link". Import = "I want to follow the source's updates, whatever my changes". Familiar from Steam Workshop, Notion templates, Figma community.

### 12.8 Pack format (export/import) — `pack/v1` schema

Export format of a pack: a `.itfz` archive (zip with a renamed extension) containing a `manifest.json` at the root + `menus/`, `templates/`, `assets/` folders + optionally `preview.png` and `README.md`. The manifest follows the `pack/v1` schema (see `docs/schema/pack/v1/`) which describes name, semver version, author, license, listed content, required plugins, etc.

`requires_plugins` is computed automatically on export from the union of each menu's `metadata.uses_plugins` — not entered by hand.

On import, the backend:

1. Validates the manifest against `pack/v1`.
2. Checks that all listed files are in the archive.
3. Validates each menu against `menu/v1` (and applies migrations if an earlier version).
4. Detects conflicts: pack id already present (re-import or rename), menu id already present elsewhere in the workspace (global namespace conflict, rename/skip dialog), missing required plugins (non-blocking warning).
5. Checks that the admin's tier covers the custom assets (otherwise, offers to import by replacing the assets with vanilla items).
6. Imports as a draft, never directly to live — the admin must publish manually.

### 12.9 Cross-pack references — soft boundary

A menu in pack A can reference a template defined in pack B without error. On export of pack A, the editor shows a warning *"This pack references the template `bouton_acheter` which lives in pack B. Include pack B in the export?"*. If yes, B is embedded in the same archive; otherwise, the export notes the external dependency and the import warns if B is absent from the target workspace.

Deliberately permissive model (not strict JS-style modules), so as not to get in the way of admins' workflows in practice.

### 12.10 Vocabulary not to be confused

| Term | Meaning |
|---|---|
| **Pack** | Organization unit in the workspace (group of menus + templates + assets). Also: the `.itfz` export format. |
| **Bundle** | Signed runtime artifact (config + resource pack) that the plugin downloads from the CDN. A distinct concept, generated automatically by the backend, opaque to the admin. |
| **Menu** | An entity openable via `/menu open`. Lives inside a pack. |

The admin thinks in packs; the plugin receives bundles; the two concepts never cross in the UI.

### 12.11 Menu redirects (V2)

When a third-party plugin provides a menu (see section 13.13), the admin may want to **replace it with a customized fork** without breaking the fact that other plugins/commands open the original menu by its namespaced id. Solution: a redirect table at the workspace level.

```ts
WorkspaceMenuRedirect {
  source_menu_id: string;  // e.g. "questx:quest_list"  ← the plugin's official id
  target_menu_id: string;  // e.g. "my_quests"          ← a user-owned menu of the workspace
}
```

At runtime, Artisan intercepts `openMenu(menuId)` calls and applies the redirect before resolving. Only one active redirect per source. Other forks coexist in the workspace, reachable by their direct id (`/menu open my_quests_v2`) but no indirect call targets them by default.

UX in the canvas (see section 4.4): the plugin menu's card shows a badge *"Redirected to `my_quests`"* if the admin has set up a redirect. Click to change the target (selection among the workspace's forks) or remove the redirect (revert to the original plugin menu).

### 12.12 Slim vs full mode for pack export

Pack export offers two modes:

| Mode | Content of the `.itfz` | Typical size | Use case |
|---|---|---|---|
| **Slim** | Manifest + menus + templates + manifest. **Assets referenced by CDN URL** (e.g. `https://cdn.artisanmc.net/u/iban/quest_btn.png`). | 10-100 KB | Embedded in a plugin JAR (see section 13.13). |
| **Full** | Manifest + menus + templates + binary assets included | 1-50 MB | Marketplace V3, archive, offline-first sharing. |

Asset paths in the menu JSON accept both relative paths (resolved against the pack's `assets/` folder in full mode) or absolute HTTPS URLs (slim mode). The runtime engine pulls the assets from the URL and serves them via the resource pack on the player side — the server itself does not need to have them locally.

**Persistence of assets distributed via plugin**: for accounts that have published their assets via a plugin (detected at `registerMenuPack`), the assets on the CDN stay **read-only in perpetuity** even if the account is deactivated. Guarantees the stability of the plugin ecosystem. To be mentioned in the ToS.

---

## 13. Third-party plugin integration API

### 13.1 Concept and strategic stakes

Let external plugins (Quests, BetonQuest, ShopGUIPlus, Aurelium Skills, MMOCore, Jobs, LobbyCosmetics...) **provide components** (single or paginable buttons, placeholders, custom actions) that the admin can use in their own menus. The third-party plugin also provides one or more **suggested layouts** that serve as an optional starting point.

The admin remains in control of their composition: they decide where to place the components, how to style them, and can freely mix them with their own slots and native actions. The plugin gives them tools; they make the menu.

Without this integration, RPG/quest servers that depend on these plugins cannot migrate from zMenu/DeluxeMenus. With it, we become the de facto standard as soon as one or two big plugins (BetonQuest, ShopGUIPlus) integrate the API. It is a classic platform network effect: every plugin that integrates makes the product indispensable for its users.

### 13.2 Java API on the third-party plugin side

```java
ArtisanAPI.register(
  PluginIntegration.builder("questx")

    // ----- Components available in the editor palette -----
    .addComponent(
      Component.builder("quest_button")
        .displayName("Quest button")
        .icon("paper")
        .paginable()                              // can occupy several slots
        .placeholder("quest_name", ctx -> ctx.getQuest().getName())
        .placeholder("quest_progress", ctx -> ctx.getQuest().getProgressPercent())
        .placeholder("quest_price", ctx -> ctx.getQuest().getPrice())
        .defaultClickAction(new StartQuestAction())
        .defaultAsset("quest_btn.png")
        .defaultLore("§7{{quest_name}}", "§ePrice: §a{{quest_price}}$")
    )
    .addComponent(
      Component.builder("pagination_prev")
        .displayName("Previous page")
        .single()
        .defaultClickAction(new PrevPageAction())
    )
    .addComponent(
      Component.builder("pagination_next")
        .displayName("Next page")
        .single()
        .defaultClickAction(new NextPageAction())
    )

    // ----- Suggested layout (optional starting point for the admin) -----
    .suggestedLayout("main", layout -> layout
      .title("Available quests")
      .size(54)
      .place("questx:quest_button", slots(10, 43))    // paginated over this range
      .place("questx:pagination_prev", 45)
      .place("questx:pagination_next", 53)
    )
    .build()
);
```

Three key primitives:

- **Components** (`Component`): building blocks that the admin can place in their menu. `single` or `paginable` mode. Each component exposes its placeholders and its default click action.
- **Placeholders**: variables resolved at render time on the third-party plugin side, usable in the titles/lores of slots that use this component.
- **Suggested layouts**: pre-filled menus (combinations of components placed at given positions) that serve as a starting point for the admin. Purely indicative — the admin can ignore or freely modify them.

### 13.3 Integration model

The third-party plugin provides two things to the editor:

- **A palette of components** that the admin can use in any menu, anywhere.
- **One or more suggested layouts** serving as an optional starting point.

The admin builds their menu freely, mixing third-party plugin components and native building blocks (custom assets, native actions). No locked slots, no reserved zones, no "delta on a live base": it is their menu, they do what they want with it.

Important consequence: a menu that uses third-party components is a **standard menu** in our format. Some slots simply reference an external component via `component_ref`, which will be resolved at render time by the plugin. Each menu is an independent artifact after creation.

```json
{
  "schema": "menu/v1",
  "id": "my_quests_menu",
  "title": "My quests",
  "size": 54,
  "background": { "asset": "bg.png" },
  "layers": [
    {
      "id": "default",
      "name": "Default",
      "elements": [
        {
          "id": "header",
          "positions": "4",
          "appearances": [{ "asset": "header.png", "title": "§6QUESTS" }]
        },
        {
          "id": "quests_list",
          "positions": "10-43",
          "appearances": [
            {
              "component_ref": "questx:quest_button",
              "asset": "quest_btn.png",
              "lore": ["§7{{questx:quest_name}}", "§ePrice: §a{{questx:quest_price}}$"]
            }
          ]
        },
        {
          "id": "btn_prev",
          "positions": "45",
          "appearances": [
            {
              "asset": "arrow_left.png",
              "click": { "left": { "actions": [{ "type": "pagination_prev" }] } }
            }
          ]
        },
        {
          "id": "btn_next",
          "positions": "53",
          "appearances": [
            {
              "asset": "arrow_right.png",
              "click": { "left": { "actions": [{ "type": "pagination_next" }] } }
            }
          ]
        }
      ]
    }
  ],
  "metadata": { "uses_plugins": ["questx"] }
}
```

At render time: the plugin resolves each `component_ref` to the component's current declaration on the third-party plugin side, applies the placeholders with the player's context, and runs the default click action (or the override if the admin replaced it). The `metadata.uses_plugins` field is computed automatically by the editor and used for warnings at publish (see section 13.9).

### 13.4 Components provided by the plugin

Each component declared by a third-party plugin exposes:

- **Namespaced ID** (`questx:quest_button`) — unique reference, collision-proof.
- **Metadata**: displayName, icon, description (used in the editor palette).
- **Mode**: `single` (one slot) or `paginable` (row of slots, the engine generates N instances for the N elements to display dynamically).
- **Placeholders**: dynamic variables resolved at render time (`{{questx:quest_name}}`, `{{questx:quest_progress}}`).
- **Default click action**: what happens when the admin hasn't overridden it (e.g. `start_quest`).
- **Appearance defaults**: asset, lore, title proposed by default. The admin can override them individually.

The admin uses components as building blocks, freely:

- **Drag & drop from the palette** onto a slot (or a row of slots, for a paginable).
- **Appearance modification**: asset, lore, title — everything is editable on top of the component's defaults.
- **Click modification**:
  - Keep the component's default: `use_component_default: true`.
  - Full override: define their own `actions` (the default is not run).
  - Composition: run the default then their own actions (`{ "use_component_default": true, "then_actions": [...] }`).
- **Choice to use or not**: the admin can build a menu without using a given available component, or reuse the same component in several places.

For paginable components, the admin selects a row of slots (e.g. `"10-43"`), assigns a paginable component, and the engine automatically generates the instances for the N elements to display according to the player's context. The `pagination_prev` and `pagination_next` buttons (`single` components) are placed wherever the admin wants, independently of the paginated row.

### 13.5 Suggested layouts: optional starting point

The third-party plugin declares one or more **suggested layouts**: ready-to-use pre-filled menus, showing useful combinations of its components. This is purely indicative.

In the editor:

- **Spawn from suggested**: the admin clicks to create a new menu pre-filled with a suggested layout. They inherit it as a starting point and then modify it as they like. The created menu is then independent — it has no more automatic link with the suggested layout.
- **View suggested layouts**: read-only preview of the plugin's current layouts, useful if the admin wants to understand the recommendations without starting from scratch.
- **Compare with a suggested one**: visual diff between the current menu and a suggested layout, purely informative.

No re-sync or "partial reset" mechanism on components. A menu, once created, is the admin's property. If the plugin updates and offers new suggested layouts, they simply appear in the list of available "Spawn from suggested" entries, with no impact on existing menus. The admin can spawn a new menu from the new suggested layout and manually migrate whatever they want to keep.

This simplicity is deliberate: we treat menus as independent artifacts after creation, not as "live instances" of the third-party plugin.

### 13.6 Plugin update lifecycle

The guiding principle is **transparency**: when the third-party plugin moves to a new version, the admin is not notified, nothing stops. The system manages to stay consistent.

Concretely:

- **New components or placeholders**: they simply become available in the editor (component palette, placeholder autocomplete). The admin discovers them when editing and can use them if they want. No notification, no popup.
- **Suggested layouts modified or added**: they appear in the "Spawn from suggested" list. No impact on existing menus.
- **Component renamed or removed**: if an admin's menu references a `component_ref` that no longer exists, the affected slot is silently ignored at render time. The admin discovers it when reopening the editor (the slot appears grayed out with an "unavailable" label) and can delete or replace it.
- **Placeholder renamed or removed**: if a placeholder is no longer provided, its rendering returns an empty string. No in-game error, just a visible blank that the admin will fix when they see it.

The rule: **the admin's menu is the source of truth**, the third-party plugin provides what it provides, we combine at render time, we ignore what is missing. This approach assumes a minimum quality from third-party plugins (they don't remove components every 2 days), but accepts that occasional inconsistencies are handled passively rather than by intrusive wizards.

### 13.7 Discovery of available plugins

Simple pull via the WebSocket: at plugin boot (or on each `/menu reload`), it sends the editor the list of detected third-party plugins, their MenuTemplates, and their versions. The editor shows in the admin's account only the plugins actually installed on the connected server.

Consequences:

- Always in sync with the server's reality.
- No cloud registry to maintain, no coordination with plugin authors.
- Trade-off: if the admin has several servers (network), a plugin installed on server A does not appear in the editor when connected to server B. To be documented clearly.

For dev/staging servers: the admin must install the third-party plugin on their dev environment too in order to edit it. Acceptable friction, equivalent to what exists with zMenu/DeluxeMenus today.

### 13.8 Namespace conflicts and collisions

- Every slot type, placeholder, and action is **mandatorily prefixed** by the plugin's namespace (`questx:quest_button`, not `quest_button` alone).
- At registration, the API rejects declarations that violate this rule with a clear message for the dev.
- Two plugins can have the same local name if they have different namespaces: `questx:main` and `betonquest:main` coexist without issue.

### 13.9 Edge cases

- **Plugin uninstalled**: the menu stays in the admin's account (editor side), but becomes "orphaned" and can no longer be published. Notification: "QuestX uninstalled. The menu is paused. Reinstall to continue." The delta is kept so the admin can resume if they reinstall.
- **Plugin present in prod, absent in dev**: the admin sees the menu on the prod server but not on dev. They must install the plugin on dev to edit.
- **Different versions across the servers of a network**: if server A runs QuestX 2.0 and server B runs 1.5, and a menu uses a component introduced in 2.0 (`questx:quest_filter`), the component will be silently ignored at render time on server B. At publish, the editor detects the situation thanks to `metadata.uses_plugins` and can warn (info, not blocking): "This menu uses QuestX 2.0+, but serverB has QuestX 1.5. Some components will be ignored." The admin chooses to publish anyway, or to update the plugin on serverB.
- **Buggy third-party plugin**: if the third-party plugin crashes at registration, the editor has no access to the MenuTemplates. Existing menus stay read-only, the admin is notified. No impact on other plugins.

### 13.10 Popular use cases to validate

The API must support the following patterns, validated against the market's major plugins:

| Plugin | Core pattern |
|---|---|
| Quests, BetonQuest | Paginated quest list + per-quest detail + accept/abandon/claim actions |
| ShopGUIPlus, EconomyShopGUI | Categories → paginated items + buy/sell actions + price variations |
| Jobs, EcoJobs | Job list + leveling display + xp progress |
| MMOCore, MMOItems | Skill trees + custom inventory + class selection |
| Aurelium Skills | Skill display + leaderboards + reward menus |
| LobbyCosmetics | Cosmetic categories + preview + equip/unequip |
| LuckPerms (admin) | Browse permissions + assign/remove tracks + group management |

Each plugin has its specifics, but the base pattern "paginated list + detail + custom actions" covers 80% of cases. The API supports this pattern via components in `paginable` mode (row of dynamic slots).

### 13.11 Native Nexo / ItemAdder integrations (V1.5)

Post-MVP killer feature: the custom items and textures declared in Nexo or ItemAdder appear directly in the editor palette, with no duplication or re-upload.

**Typical use case**: an admin has a Survival/RPG server with 200 custom items in Nexo (swords, armor, resources). To build their shop, they drag-and-drop their Nexo items directly into the menu slots. No more asset duplication between plugins, no more double maintenance.

**Two integration modes**:

- **Item mode** (recommended): the admin places a Nexo item on a slot. The format stores `material: "nexo:custom_sword"`. In-game rendering uses the Nexo item directly (its texture, its CMD, its behavior, its Nexo lore). No duplication on our side. Native coexistence thanks to 1.21.4+ pack stacking — our pack and Nexo's coexist without conflict.
- **Texture-only mode**: for decorative uses (menu header, separator, ornament), the admin can drag a Nexo texture that is copied into our pack and indexed as a standard asset. Attribution is kept in metadata (useful for traceability).

**Plugin-side discovery**:

At boot and on each `/menu reload`, the plugin scans:

- **Nexo**: via the public API (`NexoItems.entries()`) if available, otherwise by reading the configs (`plugins/Nexo/items/*.yml`).
- **ItemAdder**: via the public API if available, otherwise by reading the configs (`plugins/ItemsAdder/contents/*/configs/*.yml`).

The list (items + textures + metadata: namespace, category, displayname, default lore, CMD) is pushed to the editor via WS. The asset library shows two dedicated sources:

- **Nexo**: organized by the category declared in Nexo (weapons, armors, resources, blocks...).
- **ItemAdder**: organized by ItemAdder namespace.

Read-only sources with grid preview, search, direct drag-drop onto a slot. Automatic refresh when the admin adds an item to Nexo/ItemAdder and runs `/menu reload`.

**Intermediate format**:

An Element's `material` field accepts namespaced IDs without any structure change:

```json
{
  "id": "btn_legendary_sword",
  "positions": "15",
  "appearances": [
    {
      "material": "nexo:custom_sword",
      "title": "Legendary Sword",
      "lore": ["§7Mythical forged blade", "§ePrice: §a5000$"],
      "click": {
        "left": {
          "requirements": [{ "type": "has_money", "amount": 5000 }],
          "actions": [
            { "type": "take_money", "amount": 5000 },
            { "type": "give_item", "material": "nexo:custom_sword", "count": 1 }
          ]
        }
      }
    }
  ]
}
```

Resolution at render time: `nexo:` prefix → resolved via Nexo, `itemadder:` prefix → resolved via ItemAdder, otherwise vanilla. If the source plugin is uninstalled or the item removed, the Element shows "unavailable" (graceful degradation, same pattern as in section 13.6).

The `give_item` action also accepts namespaced materials, which makes shop / quest reward flows transparent with Nexo/ItemAdder.

**Why V1.5 and not the MVP?**

- Lets us ship the core editor faster and validate adoption before investing in a deep integration.
- Lets us observe the real distribution of admins in the user base (% who use Nexo, % ItemAdder, % neither) before calibrating.
- But to be prioritized as soon as the MVP stabilizes: most of the RPG/Survival ecosystem goes through these plugins, it is a massive selling point for this segment.

**Strategic effect**:

This integration captures the RPG/Survival segment, which represents a very significant fraction of the serious server market. Without it, these admins have to juggle Nexo/ItemAdder for their items and another plugin for their menus, with manual re-upload of textures. With it, our plugin becomes their natural menu front-end for all their existing content — no more reason to stay on zMenu/DeluxeMenus.

### 13.12 Adoption strategy

The API is useless if no third-party plugin integrates it. Adoption plan:

- **Documentation and SDK**: Java + Kotlin examples, "integrate your plugin in 30 minutes" tutorial, full javadoc.
- **Reference implementations**: fork one or two well-known open source plugins and integrate the API into them as an example. Ideally with their agreement, otherwise as separate guides.
- **Direct outreach to major authors**: contact the maintainers of BetonQuest, ShopGUIPlus, MMOCore ahead of launch, offer them free lifetime premium access in exchange for an integration within 3 months post-launch.
- **Developer Discord**: dedicated channel for API questions, priority support.
- **Showcase on the site**: "Compatible plugins" page that lists the integrations and their maturity level.

### 13.13 Plugins register full menus (V2)

In V1, plugins provide **components** (single or paginable buttons) that the admin composes in their own menus. In V2, the third-party API widens: plugins can register **full menus** in the admin's workspace via:

```java
artisan.registerMenuPack(byte[] packArchive);
```

The plugin reads its `.itfz` embedded in its JAR (typically `resources/artisan-pack.itfz`) and passes the bytes to the API in `onEnable`. Artisan parses the archive, validates against `pack/v1`, and registers the menus under the **calling plugin's namespace** (auto-derived via `Plugin.getName()` on the Bukkit side) — `questx:quest_list`, `questx:quest_detail`, etc. No namespace to declare manually.

**Plugin dev workflow:**

1. Sign up on `editor.artisanmc.net` (free account is fine)
2. Design their menus visually in the editor, like any admin
3. Upload their custom assets (they go to the R2 CDN under their account)
4. Export the pack in **slim** mode (see 12.12) — JSON only, assets referenced by CDN URL. Typical size: 30-100 KB.
5. Embed the `.itfz` in their JAR
6. Minimal Java code: read the bytes, call `registerMenuPack`. The plugin no longer has to write a single line of manual YAML/JSON for its menus.

**Admin side:**

- Menus registered by plugins appear on the canvas (see 4.4) with a distinct styling (colored border, "provided by questx" badge).
- The admin can **fork** a plugin menu to customize it, creating a user-owned menu in their workspace. The fork loses the upgrade link with the source.
- The admin can **redirect**: *"when something opens `questx:quest_list`, open `my_quests` instead"* (see 12.11).
- The admin **cannot edit** a non-forked plugin menu directly — the plugin has control over it.

**Strategic benefits:**

- Plugin devs become Artisan users (eat your own dogfood, multiply adoption).
- No more YAML hardcoded in plugins → better UX for them.
- Plugin assets fill Artisan's CDN → network effect (admins discover assets for free).
- Admin networks see their full menu graph (their own menus + plugin menus) on a single canvas.

To be documented in V2 in the dedicated plugin dev section of `docs.artisanmc.net`.

### 13.14 Plugins register their own data sources (V2)

While `registerComponent` (section 13.4) covers UI components with a plugin-owned layout, and **homemade data sources** (section 14) cover popular plugins before they integrate, V2 adds the complementary pattern: `registerDataSource(...)`. A plugin author can ship their own official connector, which overrides our homemade one.

```java
// V2 — example of the third-party plugin-side API
ArtisanAPI.registerDataSource(DataSource.builder()
    .ref("chestshop:items")              // overrides our homemade
    .schema(ItemDTO.class)               // shape of the returned objects
    .fetcher((server, params) -> {
        return chestShop.getAllItems().stream()
            .filter(matches(params))
            .map(this::toDTO)
            .toList();
    })
    .suggestedLayout("templates/shop_grid.json")  // optional
    .build());
```

Benefits for the author: control of the shape (the exposed schema is exactly what they want), optimized performance (direct access to their internals rather than via a public API), a suggested layout they control, their brand visible in the editor palette ("Official: ChestShop").


---

## 14. Data sources and menu context

The third-party plugin API (section 13) covers the case where a plugin **wants to integrate Artisan**: it calls `registerComponent`, delivers its layout and its behavior. But that assumes the plugin author has made the effort. For Artisan at V1, we can't wait for QuestX, ChestShop, or EssentialsX to take the time to integrate.

**The solution**: we flip the model. Instead of waiting for plugins to push their data, **we pull it** via custom connectors that we write ourselves for popular plugins. The ChestShop admin opens Artisan, selects *"Bind to ChestShop items"*, and designs their shop visually — without ChestShop having done anything. When the plugin author wants to take over, they can (V2 via `registerDataSource`).

### 14.1 Model: the menu's `contextInputs`

Every data flow entering a menu — whether it comes from the caller or from a connector — goes through `Menu.contextInputs`. A `ContextInput` is a **named, typed slot** that the menu declares; its value can come from three sources, chosen per field:

- **Caller**: the command (see §15) or the parent menu passes the value on open (auto-binding by name, see §15.4).
- **Connector**: the input carries a `source: ConnectorBinding`; the engine calls the referenced connector and stores the result in the slot.
- **Default**: literal fallback value if the caller provided nothing and no connector is attached.

```ts
ContextInput = {
  name: string,                    // slug of the slot, exposed as {name} in fields
  type: "player" | "string" | "integer" | "number" | "boolean" | "list" | "object",
  default?: string,                // literal fallback
  source?: ConnectorBinding        // optional, mutually exclusive with a caller that would pass the value
}

ConnectorBinding = {
  ref: string,                     // "chestshop:items", "essentials:warps"
  params?: Record<string, string>, // connector-specific config, supports {name} interpolation
  filter?: Record<string, string>, // where-clauses on the returned fields, supports {name}
  sort?: { by: string, direction?: "asc" | "desc" },
  limit?: number                   // default = number of positions of the Element iterating this slot, max 1000
}
```

`source` is valid on `type: "list"` (the connector returns a list of objects) and `type: "object"` (the connector returns a single object).

### 14.2 Iteration

An Element becomes iterative via `iterates: { source, alias }`. `source` is the `name` of a `ContextInput` of type `"list"` (it doesn't matter whether the list comes from the caller or a connector — the slot is opaque). `alias` is the local name each item takes in the Element's scope: its fields (title, lore, material, click, conditions) access the item's fields via `{alias.field}`.

```json
{
  "id": "shop_menu",
  "contextInputs": [
    { "name": "category", "type": "string" },
    {
      "name": "shops",
      "type": "list",
      "source": {
        "ref": "chestshop:items",
        "filter": { "category": "{category}" },
        "sort": { "by": "price", "direction": "asc" },
        "limit": 28
      }
    }
  ],
  "layers": [{
    "id": "items",
    "elements": [{
      "id": "shop_grid",
      "positions": "10-43",
      "iterates": { "source": "shops", "alias": "shop" },
      "appearances": [
        {
          "if": [{ "type": "placeholder_equals", "placeholder": "{shop.rarity}", "value": "legendary" }],
          "material": "{shop.material}",
          "title": "<gold><bold>{shop.name}</bold></gold>",
          "lore": ["<yellow>Price: {shop.price} coins</yellow>"],
          "enchanted": true,
          "click": {
            "left": { "actions": [{ "type": "run_command", "command": "cs buy {shop.id}" }] }
          }
        },
        {
          "material": "{shop.material}",
          "title": "<white>{shop.name}</white>",
          "lore": ["<yellow>Price: {shop.price} coins</yellow>"],
          "click": {
            "left": { "actions": [{ "type": "run_command", "command": "cs buy {shop.id}" }] }
          }
        }
      ]
    }]
  }]
}
```

For each item returned by the connector, the engine evaluates the appearances in order. Conditions on the item's fields use `placeholder_equals` / `placeholder_match` with `{alias.field}`; player conditions (`has_money`, `has_permission`, etc.) are still evaluated with the normal player context.

### 14.3 Three coexisting patterns for an Element

| Pattern | Layout | Data | Use case |
|---|---|---|---|
| **`iterates` on an input with `source: ConnectorBinding`** | Admin (via Artisan) | Plugin (via connector) | Artisan connector for ChestShop, EssentialsX warps, etc. The admin designs their shop as they want. |
| **`iterates` on an input passed by the caller** | Admin | Caller (command / parent menu) | List passed explicitly, e.g. the `/shop <category>` command passes `shops: [...]` after filtering on the command side. Rarely used but allowed. |
| **`appearance.component_ref` (plugin registered)** | Plugin author | Plugin | QuestX ships its quest button with its default layout, the admin can just override the click or the title. |
| **Static Element** | Admin | Admin | Button that runs a command, with no dynamic data. |

All coexist in the same menu. A menu can mix a grid bound to `chestshop:items` with a static "Buy currency" button and a paginable `essentials:warp_button` component.

`iterates` and `component_ref` **cannot coexist on the same Element** — `validateMenuLayout` flags the errors.

### 14.4 Connectors at launch (V1)

Five **homemade Artisan** connectors that cover ~80% of modern Minecraft servers:

| Plugin | Exposed data sources |
|---|---|
| **EssentialsX** | `essentials:warps`, `essentials:kits`, `essentials:jails` |
| **ChestShop** | `chestshop:items`, `chestshop:categories` |
| **JobsReborn** | `jobs:list`, `jobs:player_progress` |
| **LuckPerms** | `luckperms:groups`, `luckperms:tracks` |
| **Quests** | `quests:active`, `quests:completed`, `quests:available` |

For each connector, we document the **schema of the returned objects** (`id`, `name`, `material`, etc. fields) at `docs.artisanmc.net/connectors`. The Java code on the Artisan plugin side fetches the data via the source plugin's public API (e.g. `EssentialsX#getWarps()`).

V1.5+: we extend the catalog (ShopGUIPlus, mcMMO, BetonQuest, WorldGuard regions, Vault, etc.) based on Discord/Reddit demand.

### 14.5 Connectors: who writes them, how

**V1 — Artisan homemade**: we write the connectors ourselves in Java, packaged in the Artisan plugin. They depend on the source plugins via `softdepend` in `paper-plugin.yml` (conditional loading — no crash if EssentialsX is absent).

**V2 — registerDataSource (plugin author)**: a plugin author can ship their own official connector via a new `ArtisanAPI.registerDataSource(...)` API (parallel to the current `registerComponent`). Override system: if an official plugin registers for `chestshop:items`, it replaces our homemade one. Benefits for the author: control of the shape, optimized performance, default suggested layout.

**V2.5+ — user-defined connectors**: a power-user admin will be able to define their own connectors via a simple YAML DSL ("this plugin config file, read these keys, expose these fields"). Allows supporting niche plugins without us adding them officially.

### 14.6 Maintenance of homemade connectors

Real risk: every major update of EssentialsX/ChestShop/etc. can break our connector. Mitigation:

- **CI integration tests**: we spin up a Paper with EssentialsX in Docker and check that `essentials:warps` returns the right list.
- **Pinning supported versions**: each connector declares the minimum/maximum supported version in its metadata.
- **Natural pressure toward V2**: a plugin author who sees their connector is popular with admins has a motivation to ship the official one and take back control.
- **Estimated effort**: ~2-4h/month of maintenance per connector in the long run. For 5 connectors at launch, that is 10-20h/month — acceptable for a solo dev.

### 14.7 Editor UX

The connector binding is edited **at the menu level**, in the `MenuProperties` panel next to the `contextInputs` list:

- On an input of type `"list"` or `"object"`, a **"Source"** selector offers two choices: *"passed by the caller"* (default) or *"connector"*.
- *Connector* mode: dropdown listing the available connectors (filtered according to the plugins detected on the connected server). Hovering a connector shows the schema of the returned objects (available fields).
- **Filters / sort / limit**: UI typed according to the selected connector's fields. Values support `{name}` to interpolate the menu's other `contextInputs` (e.g. `filter: { category: "{category}" }`).
- **`{alias.field}` auto-completion**: in all text fields of an Element that has `iterates: { source: input, alias }`, autocomplete suggests the fields of the connector's object (or of the list passed by the caller) in addition to PAPI and i18n placeholders.
- **Live preview**: if a `sampleContext` is provided, the editor preview uses it as is; otherwise, in connector mode, the editor can call the connector (via the backend's mock API) to render 3-5 example items.

### 14.8 Synergy with the MCP server (V2)

The `artisan-mcp` MCP server natively exposes the connectors to the client LLM (Claude Desktop / Cursor) as **standardized MCP tools**: *"list all Essentials warps on this server"*, *"create a menu that iterates the ChestShop items under €100"*. No additional work on top of the `ConnectorBinding` model — a registered connector automatically becomes an MCP tool.

### 14.9 V1 limits

- No **cross-source join/lookup** (e.g. "ChestShop items whose crafter is in the LuckPerms top 10"). One input = one source. In V2 if demand emerges.
- No **mutations** via connectors (they are read-only). To modify a plugin's data, go through `run_command` or a `component_ref` that runs an action.
- No **cross-player caching**: the connector is called per menu opening. If the data is expensive to fetch, the connector itself implements its cache. Clear documentation on cache best practices for connectors.
- **Max limit 1000 items** per `ConnectorBinding` to avoid runtime abuse. In practice, Minecraft inventories cap at 54 slots, so this limit is never legitimately reached.
- **No cycle between `contextInputs`**: a `filter` that interpolates `{name}` can only reference an input whose value is resolvable upstream (caller or connector with no circular dependency). The editor computes a topological order and flags cycles.

---

## 15. Commands

Artisan lets the admin **create their own commands** from the editor, at the same level as a menu. A command is a first-class entity: it has its id, name, arguments, actions, and lives in the same workspace as menus (and the same `.itfz` pack on export).

A concept analogous to a `commands.yml` or a custom commands plugin (CommandPanels, etc.), but with:

- The **menu action catalog** reused as is (see section 5).
- A **typed argument system** with automatic tab-completion.
- **Argument values** auto-bound by name to the `contextInputs` of the menus opened (see §15.4).
- The visual editor: no YAML to type, live validation, placeholder hints.

### 15.1 Model

A command contains:

- **Metadata**: `id` (internal slug), `name` (typed in game without the slash), `aliases[]`, `permission`, `description` (player-visible), `notes` (admin-internal).
- **Arguments**: ordered list of typed positional arguments.
- **Requirements**: conditions ANDed before execution (same types as in menus).
- **Actions**: the sequence to run (same 15 types as in menus).
- **Fallback**: actions run if requirements fail.
- **Cooldown**: optional, scope `player` or `server`.

Full schema: `docs/schema/command/v1/`.

### 15.2 Argument types (V1)

8 initial types, enough for common use cases:

| Type | Meaning | Tab-completion |
|---|---|---|
| `player` | player name (online or offline, resolved via UUID) | online + known to the server |
| `online_player` | name of a connected player | online only |
| `string` | free text | none |
| `integer` | integer | none |
| `number` | floating-point number | none |
| `boolean` | true/false | true, false |
| `world` | name of a loaded world | loaded worlds |
| `enum` | value from a list set by the admin | values of the list |

Each argument has a name (slug), a `required` flag (true by default), and optionally a `default` that supports placeholders (useful for `%player_name%` when the admin wants to target the command's author by default).

Ordering rule: `required` arguments must precede optional ones. The editor enforces this on drag-and-drop.

V2+ will add: `item_material`, `enchantment`, `entity_type`, `region` (from WorldGuard), custom suggestions via dynamic placeholders.

### 15.3 Arguments and context

When the command runs, the arguments are parsed according to their type. A parse failure (player not found, world not loaded, invalid enum value) sends a typed error message to the player and the command is **not run** (no fallback, it is invalid input, not a failed requirement).

Once parsed, the arguments become **named values in the command's scope**, identified by their argument name. When the command runs an `open_menu`, these values are passed to the target menu via auto-binding by name (see §15.4): an argument named `target` automatically arrives in a `target` `contextInput` of the opened menu.

For complex types (`player`, `online_player`), the value is an object exposing derived fields accessible via `{<name>.<field>}` in any text field of the menu:

| Type | Exposed fields |
|---|---|
| `player` / `online_player` | `name` (string), `uuid` (string), `displayname` (string) |

In the `actions`, `fallback`, and `requirements` of the command **itself** (before a menu is opened), arguments are accessible directly by name via `{<name>}` and `{<name>.<field>}` — the same syntax as in menus, to stay uniform.

### 15.4 Context propagation (auto-binding by name)

When an `open_menu` is run (from a command, a menu click handler, or another `open_menu`), the engine populates the target menu's `contextInputs` in two passes:

1. **Auto-binding by name**: for each `contextInput` of the target menu, if a value of the same name exists in the current scope (command arguments, the calling menu's `contextInputs`, current iteration alias if the `open_menu` is inside a loop), it is passed. Typing must match — otherwise the editor warns at design time and the runtime ignores it.
2. **Explicit override** via `OpenMenuAction.context: Record<string, string>`: each entry overrides the auto-binding. The value can interpolate placeholders from the current scope (e.g. `{ "shop": "{currentItem}" }` to map onto a different name).

```jsonc
// shop_menu.contextInputs : [{ name: "category" }, { name: "shops", type: "list", source: {...} }]
// shop_menu Element : iterates: { source: "shops", alias: "shop" }

// Click handler in shop_menu, target = item_detail (declares contextInput "shop") :
{ "type": "open_menu", "menu_id": "item_detail" }
// → auto-bind "shop" from the current iteration alias. No mapping needed.

// If the target menu declares "item" instead of "shop", map explicitly:
{ "type": "open_menu", "menu_id": "item_detail", "context": { "item": "{shop}" } }
```

**`clear_context: true`**: cuts the auto-binding (the explicit override stays active). Useful for "Back to home" buttons that must not inherit a specific target. If the target menu declares `contextInputs` with neither a `default` nor a `source: ConnectorBinding`, opening fails with a message to the player.

```json
{ "type": "open_menu", "menu_id": "main_menu", "clear_context": true }
```

Decision: auto-binding by default, explicit override when names diverge, `clear_context` for intentional breaks. This model replaces the implicit `%args_*%` propagation of the initial prototype — more explicit, contractualized via `Menu.contextInputs`, verifiable at design time.

### 15.5 Use cases covered

With this model, the admin can cover without a third-party plugin:

- `/heal` → direct actions, no menu (`give_xp`, `play_sound`, `send_message`).
- `/profile [target]` → opens `profile_menu` with context.
- `/shop` → opens `shop_menu` (short alias, equivalent to `/menu open shop`).
- `/pay <player> <amount>` → take_money + run_command (eco) + send_message.
- `/warp <name>` with `name` typed `enum` → autocompleted list of warps.
- `/admin-give <player> <material>` (admin perm) → give_item to the target player.

### 15.6 Name conflicts

At startup, the plugin detects conflicts with commands already registered on the server:

- **Vanilla** (`heal`, `tp`, etc. native or via `commands.yml`): Artisan refuses to override them, logs a warning, and asks the admin to rename.
- **Another plugin**: same, refusal + warning visible in the logs.
- **Internal conflict** between two Artisan commands (same name in two enabled packs): last loaded loses, a warning is logged, the admin is notified in the editor.

Never a silent override — an admin must always know which command is active for which name.

### 15.7 Pricing

Commands have **no quota** in any tier. A command costs ~1 KB of storage and zero runtime (no rendering, no persistent WS). Artisan quotas are on linked servers and team seats, not on content resources (see section 3).

### 15.8 Workspace and packs

Commands appear in the dashboard next to menus, with their own tab/filter. On the multi-menu canvas (see section 4.4), a command is represented as a distinct node (dedicated shape/color), with an arrow to the menu it opens (if any — otherwise a "leaf" node).

On `.itfz` export, the pack manifest includes a `commands[]` section next to `menus[]`. See `docs/schema/pack/v1/`.

### 15.9 V1 limits

- No **variadic** arguments (e.g. `/say <message...>`). By convention the last `string` captures all remaining tokens if needed, but no special syntax in V1.
- No branched **subcommands** (e.g. `/admin give|kick|ban`). To be handled via several named commands (`/admin-give`, `/admin-kick`) or an admin menu.
- No dynamic **custom suggestions** beyond `enum`. To be added in V1.5+.
- No **chained commands** (a command that calls another command). Possible via `run_command` but it goes back through the text parser, not ideal.

---
## 16. Authentication and teams

### 16.1 Login

**Two authentication methods** available from V1, **account required from the free tier**:

- **Discord OAuth** (primary, recommended): 1 click, ~3 seconds. A culturally aligned choice — 99% of Minecraft admins are already on Discord. Native SSO, built-in Discord 2FA, stable identity.
- **Email + password**: universal, fallback for those without Discord. Mandatory email verification to activate the account. ~30 seconds at signup.

Backend implementation: **Lucia Auth** (lightweight lib for Fastify, handles sessions, refresh tokens, account linking). argon2id hashing for email passwords.

**Account linking**: one email = one account. The admin can additionally link a Discord OAuth for SSO, but the email remains the canonical identifier. Avoids the "I signed up with Discord then changed my Discord, I lost my account" kind of hassle.

**Why no anonymous workspace**: we evaluated and ruled out an `/artisan editor` flow that would authenticate via an in-game token without an account. Three reasons:
1. **Security**: a token displayed in plain text in MC chat can be read by another OP, by server logs, or by any plugin that hooks the chat. An attacker who intercepts the link has 5 minutes to claim it before the legitimate admin.
2. **Conversion**: without an account, no email for remarketing, no cross-device session, no tier abstraction that groups N servers. Anonymous free would block any conversion to Pro.
3. **Operations**: no billing possible without an account, no support, no recovery.

Requiring an account is not friction — Discord OAuth = 3 seconds, and the security gained is well worth the micro-effort of signing up.

### 16.2 `/artisan editor` — authenticated shortcut

The `/artisan editor` command stays in the plugin as a **deeplink shortcut** to the current workspace, not as an auth bypass:

1. Admin already signed in to Artisan, puts the plugin on a server linked to their account.
2. On the server, they type `/artisan editor`.
3. Plugin displays: *"Open editor: https://editor.artisanmc.net/server/<id>"*.
4. Click → browser opens the editor, **existing session detected via JWT cookie** → lands directly on the right workspace with the server context pre-filled. If there is no active session in the browser → redirects to the normal login (Discord/email).

It is a useful shortcut (skips the manual "open editor → pick the right server" navigation), not a separate auth mechanism. The account remains king.


### 16.3 Recovery email

At account creation, the admin links a (non-Discord) recovery email. If Discord access is lost (ban, suspended account), manual support procedure:

1. The admin contacts support from the recovery email.
2. Identity verification (proof of ownership of the Minecraft servers: command on the linked servers, screenshot, etc.).
3. Manual re-binding to a new Discord account.

### 16.4 Multi-user (teams)

In the V1 spec, two levels:

- **Solo account**: a single user, Free or Pro tier.
- **Team account**: several members, possible on all paid tiers. Members are identified via Discord:
  - **Method 1**: invitation by Discord username.
  - **Method 2** (elegant): "all members with the @admin role on my Discord server" — the editor listens to Discord role changes.

Permissions within the account: Owner (everything), Admin (edits and publishes), Editor (edits, cannot publish), Viewer (read-only).

### 16.5 Sessions

JWT with rotation. Session valid for 7 days, transparent refresh. If the Discord connection is revoked (ban), the session expires at the next validation.

---

## 17. WebSocket protocol

**Note**: the persistent WebSocket is active in **cloud mode** (the default, available to all Free + Pro tiers). In **local mode** (opt-in for strict offline/self-hosted), no outbound connection is opened. Everything below describes cloud mode.

### 17.1 Handshake

Outbound connection from the plugin to `wss://api.artisanmc.net/ws/plugin` (the backend host — `editor.artisanmc.net` only serves the editor SPA and proxies neither `/ws` nor `/api`). Authentication via:

```json
{
  "type": "hello",
  "server_key": "sk_xxxxxxxxxxxx",
  "plugin_version": "1.0.0",
  "minecraft_version": "1.21.4",
  "current_bundle_hash": "sha256:abc..."
}
```

The editor validates the `server_key`, checks usage uniqueness (server fingerprint), and replies:

```json
{
  "type": "hello_ack",
  "session_id": "sess_xxxxxx",
  "server_id": "srv_xxxxxx",
  "tier": "network",
  "needs_sync": true | false,
  "latest_bundle_hash": "sha256:def..."
}
```

### 17.2 Editor → plugin messages

| Message | Description |
|---|---|
| `bundle_available` | New bundle ready on the CDN, URL provided + signature |
| `draft_update` | Incremental update of a menu's draft |
| `publish` | Promote a draft to live |
| `rollback` | Revert to an archived version |
| `placeholder_query` | Request the list of installed PAPI placeholders |
| `permission_query` | Request the list of available permissions (LuckPerms, Vault) |
| `material_query` | Request the list of the server's materials/items |

### 17.3 Plugin → editor messages

| Message | Description |
|---|---|
| `sync_complete` | Bundle received and activated |
| `sync_failed` | Error, reason |
| `placeholder_response` | List of available placeholders |
| `permission_response` | List of permissions |
| `material_response` | List of materials |
| `event_menu_opened` | Metrics (who opened which menu, when) |
| `event_action_executed` | Metrics (action triggered, success/failure) |

### 17.4 Reconnection

Plugin side: exponential reconnection (1s, 2s, 4s, 8s, 16s, max 60s). On reconnect, the handshake includes `current_bundle_hash`; if the editor has a more recent version, it pushes `bundle_available`.

### 17.5 Robustness

- Idempotent messages when possible (a re-received `live_publish` breaks nothing).
- Heartbeat (`ping`/`pong`) every 30 seconds.
- Message buffer on the editor side if the plugin is disconnected (max 100 messages, dropped otherwise with a "do a full sync" fallback).

---

## 18. Tech stack

### 18.1 Minecraft plugin

**Internal architecture**: the plugin has two menu providers, **available in all tiers**:
- `CloudMenuProvider` (default, all tiers): maintains the WebSocket to `wss://api.artisanmc.net/ws/plugin`, pulls bundles from the CDN. Active as soon as a valid `server_key` is configured.
- `FilesystemMenuProvider` (opt-in, offline): reads `plugins/Artisan/menus/*.{json,yaml}` from disk, watches the files for optional automatic reload. For admins who want no cloud dependency (sovereignty, air-gapped environments).

The rendering engine (parse menu/v1, evaluate appearances, generate the Bukkit inventory) is shared by both providers — only the data source differs. The default mode is cloud; local mode is enabled via `config.yml` (`mode: local`).


- **API**: Paper API (since 1.21.4), with Spigot compatibility. Prefer Paper for the richer events and performance.
- **Language**: Java 21 (LTS, required by 1.21+) or Kotlin (modern, concise).
- **Build**: Gradle, paper-userdev plugin for mojmap.
- **Key dependencies**:
  - Vault (economy, optional at load)
  - PlaceholderAPI (placeholders, optional at load)
  - WorldGuard (regions, optional)
  - LuckPerms (permissions, optional)
- **Persistence**: embedded H2 or SQLite for cooldowns and bundle metadata. Minimal `.yml` config (server_key, local HTTP port, tier override for debug).

### 18.2 Web editor

- **Frontend**: React 18+ with Vite. Strict TypeScript.
- **Drag & drop**: `@dnd-kit/core` (performant, accessible, modern).
- **State**: Zustand or Jotai (lightweight, sufficient). Redux ruled out (overkill).
- **UI components**: shadcn/ui or Mantine (polished aesthetics needed for the positioning).
- **WebSocket client**: custom connection management + auto-reconnect.

### 18.3 Editor backend

- **Runtime**: Node.js 20+ with TypeScript.
- **Framework**: Fastify (performance and type-safe) or Hono (modern, edge-ready).
- **DB**: PostgreSQL for accounts, bundles, metadata. Redis for sessions and WebSocket state.
- **Asset storage**: S3-compatible (Cloudflare R2 recommended for cost, no egress fees).
- **CDN**: Cloudflare in front of the storage (aggressive caching, global network).
- **Auth**: Discord OAuth via NextAuth or a lightweight custom implementation.
- **Payment**: Stripe Subscriptions.
- **Pack generation**: Node workers + the sharp library for resizing, archiver for the .zip.

### 18.4 Infra

- **Hosting**: Fly.io or Railway for the backend (simple, scalable, multi-region).
- **Managed DB**: Supabase (PostgreSQL + auth assist) or Neon (serverless Postgres).
- **CDN**: Cloudflare.
- **Monitoring**: Sentry (errors), Plausible or PostHog (product analytics).
- **CI/CD**: GitHub Actions.

### 18.5 Security

- All tokens in HttpOnly cookies (never localStorage).
- Server keys hashed on the backend (Argon2).
- Bundles signed with ECDSA P-256.
- Rate limiting on the API (per account and per IP).
- Strict upload validation (PNG only, magic bytes check, size).
- Sandboxed asset parsing (MCModels parser in an isolated worker).

---

## 19. Distribution / GTM

### 19.1 Free plugin (vanilla)

Distributed everywhere to maximize adoption:

- **SpigotMC**: the largest audience (~250k+ active admins). Distribute here first.
- **Modrinth**: modern, growing, Paper-friendly audience. A good complement.
- **Direct download page** on the site (for SEO and for those who don't go through the hubs).

Note: SpigotMC forbids subscription models. The premium version cannot be listed there; only the vanilla version is.

### 19.2 Premium (subscription)

Distributed only via:

- **Editor account**: the admin upgrades from their dashboard, Stripe payment.
- **Pricing page** on the site.
- **"Upgrade" button** built into the editor, triggered as soon as someone tries to use a custom asset in free mode.

Possible future:

- **BuiltByBit**: to sell ready-made menu packs (once the marketplace is operational). Qualified audience.
- **Polymart**: possible alternative, lower priority.

### 19.3 Launch marketing

- **Public demo server**: `mc.artisanmc.net`. Anyone can connect and test the plugin in action. NxMenu's lack of a demo is a concrete competitive advantage.
- **Showcase video** (2-3 minutes): live editing (the WS is an unbeatable visual feature), building a shop menu in 5 minutes, a demo of coexistence with Nexo.
- **Community Discord**: support, feedback, sharing configs between users (seed of a community before the marketplace).
- **Reddit presence**: `r/admincraft`, `r/Minecraft` — release post then weekly showcases.
- **Minecraft YouTuber outreach**: server tutorial creators (French and English-speaking), send the free plugin + premium access for testing.
- **Technical blog**: 1-2 initial articles ("how we solved coexistence with Nexo", "why we chose 1.21.4+"). SEO + dev credibility.

### 19.4 Post-launch success metrics

- **Adoption (month 1)**: >1000 vanilla downloads.
- **Adoption (month 3)**: >5000 active servers (plugin loaded and used).
- **Premium conversion (month 3)**: >5% of active servers upgrade.
- **Premium churn**: < 10% monthly at 6 months.
- **Editor NPS**: > 40.

---

## 20. Explicit MVP scope

### 20.1 Included in the MVP (V1)

The whole foundation of the product described above:

- Full web editor (unified mode with progressive disclosure + JSON Export/Import).
- Versioned, documented, AI-ready JSON schema (TypeScript types + JSON Schema published).
- Persistent WebSocket with live editing.
- Live / Draft workflow with rollback.
- **Workspace organized into packs** (auto-created Personal + user-created packs), with assignment of menus/commands/templates/assets to a pack. No pack export/import yet in V1 — only export of a single menu (.menu.json) or a single command (.cmd.json).
- **Multi-menu canvas** (see section 4.4): Figma-like view with menu cards and auto-derived `open_menu` arrows. "List/Canvas" toggle in the dashboard toolbar. React Flow as the canvas library. Implementation is bounded because the code is generated with AI assist — a few hours to a few days more than the List view.
- **Custom commands** (see section 15): first-class entity alongside menus. Typed arguments with tab-completion (8 initial types), requirements + fallback + cooldown, argument values auto-bound by name to the `contextInputs` of opened menus (see §15.4). No quota — unlimited in all tiers.
- **Unified MiniMessage + i18n text format** (see section 10): all text fields (titles, lores, messages, command descriptions) are in MiniMessage with live preview in the editor. Inline `{i18n:key}` i18n system scoped to the workspace, with key creation/editing without leaving the editing context (`{` key for autocomplete, "+ New key" to create with auto-extract of the current text). Server modes: single language, player locale (recommended), or PAPI placeholder. No quota on keys, unlimited in all tiers.
- 15 atomic actions.
- Conditions, requirements, fallback, cooldowns.
- Conditional appearances (variants by condition) + Layers (top→bottom organization with fall-through).
- User-defined templates with variables.
- Asset library with uploads, MCModels imports (.zip), folders, tags, search.
- Resource pack generation (CMD strings 1.21.4+, custom fonts, CDN hosting).
- **Third-party plugin integration API** (registerComponent single/paginable, placeholders, default actions, suggested layouts, palette in the editor, sync via WS, passive degradation on missing components).
- **Data sources via connectors** (see section 14): `Menu.contextInputs` can carry a `source: ConnectorBinding` that auto-fetches a list/object from a third-party plugin; Elements iterate over it via `iterates: { source, alias }` with a layout owned by the admin. **5 homemade connectors at launch**: EssentialsX (warps, kits, jails), ChestShop (items, categories), JobsReborn (list, player_progress), LuckPerms (groups, tracks), Quests (active, completed, available). Covers ~80% of modern Minecraft servers from day 1.
- Authentication: Discord OAuth + Email/password (Lucia Auth on Fastify), account linking via canonical email.
- Basic multi-user (teams).
- Multi-admin soft-lock.
- **Perpetual free + Pro model for texture hosting**: account required (Discord OAuth or email/password). Free = full visual editor + live edit + all design features + vanilla materials + Nexo/ItemsAdder/Oraxen integration, 1 server. Pro = €30/year or €80 lifetime — unlocks PNG upload + auto CDN pack management + server signature, MCModels import, multi-server (5), AI 50/month (V1.5), unlimited version history, 50 GB storage. Single paid tier. Annual by default at checkout, lifetime push at launch. Founder rate -30% locked-in for the first 3 months.
- Light anti-crack (signature at sync).
- Multi-channel distribution (SpigotMC, Modrinth, site, Stripe).
- Third-party API documentation (Javadoc + tutorial + 1-2 reference implementations).

### 20.2 Explicitly out of MVP scope (V2+)

- **Native variables** (player/server/session scopes). PlaceholderAPI is enough to start.
- **Auto-convert** from zMenu / DeluxeMenus configs. To be evaluated based on demand.
- **Native marketplace** for packs/menus. To be considered after validating a significant user base; in the meantime, MCModels integration.
- **Real-time collaborative editing** Figma-style. Soft-lock is enough for the MVP.
- **Staging environment** (frozen preview available to invited testers). Postponed to V1.5 when team workflows become a real use case; in the meantime, only the personal draft + publish to live are supported.
- **Export/Import of full packs** (.itfz). In V1, only export/import of a single menu is available. Pack export/import with a find-&-replace wizard for env-specific values arrives in V1.5 (consistent with the arrival of the MCModels importer).
- **Native pack marketplace**. V3 (signature, pricing, reviews, discovery).
- **Continuous refresh of conditional appearances** (for real-time dynamic progress bars).
- **Native Nexo / ItemAdder integration**: postponed to **V1.5** (post-MVP-stabilization killer feature — see section 13.11). Will allow direct drag-and-drop of Nexo/ItemAdder items and textures in the editor.
- **Bedrock support** (Geyser).
- **HTML/CSS framework mode** or advanced design systems.
- **Alternative economy actions** (PlayerPoints, CoinsEngine, etc.). Vault covers 80% at the MVP.
- **Queue / BungeeCord / Velocity actions** (`send_to_server`). To be added as soon as the network need emerges.
- **Persistence / quest actions** (Quests, BetonQuest integration). V2 depending on RPG servers.
- **`play_particle` and `set_placeholder` actions**. Postponed.

---

## 21. Roadmap V2+ (indicative)

| Version | Features | Target (post-launch) |
|---|---|---|
| V1.1 | Editor quality-of-life, bug fixes, performance optimizations, first API integrations by partner plugins | M+1 to M+3 |
| V1.5 | **Killer feature 1: native Nexo / ItemAdder integration** (items and textures drag-and-drop in the palette, item mode + texture mode, graceful degradation). **Killer feature 2: built-in AI assistant** ("Ask AI" button that takes natural language and applies mutations to the JSON via the Claude API; also plugs into the V1 canvas to create/link menus visually). Plus: **Staging** environment, **export/import of full packs** (.itfz) with find-&-replace wizard, **slim** mode for plugin distribution (see 12.12), MCModels importer to .itfz, `play_particle`, `set_placeholder`, alt economy actions (PlayerPoints, etc.), enriched third-party API (events, hooks, complex actions). Public dev doc with JSON schema. | M+4 to M+6 |
| V2 | **Killer feature 1: `artisan-mcp` MCP server** (Claude Desktop / Cursor / other MCP clients can list, read, mutate menus from their tool). **Killer feature 2: plugins can register full menus** (see section 13.13 — `registerMenuPack` API, auto-derived namespace, fork + workspace-level redirects). Plus: native variables (player/server/session) + continuous refresh of conditional appearances + Bungee/Velocity actions + synchronized multi-server editing | M+6 to M+9 |
| V2.5 | zMenu/DeluxeMenus auto-convert + deep Nexo/ItemAdder integration (cross-plugin editing: create a Nexo item from our editor) + cloud registry of popular integrations | M+9 to M+12 |
| V3 | Native marketplace (assets + menus + third-party integrations) + collaborative editing (Figma-like) + Bedrock support | M+12+ |

---

## 22. Risks and mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Mass cracking of premium | High | Medium | Server-bound signature; communicate an "ethical product" to limit cracks; fast iteration to make the paid tier superior in perceived value |
| Slow adoption against established zMenu/DeluxeMenus | Medium | High | Killer features: live editing + asset library + MCModels import; strong showcase video; auto-convert in V2 |
| Exploding CDN costs | Low | Medium | Quotas per tier; aggressive caching; plugin self-host option for the very large |
| Conflict with Nexo/ItemAdder in practice | Low | High | 1.21.4+ and CMD strings eliminate the risk by design; testbed from the start with Nexo installed |
| Discord ban of a key customer | Low | High | Mandatory email recovery; documented support procedure |
| Subscription culturally rejected | Medium | High | Communicate "you can cancel anytime, your existing menus stay"; no periodic re-validation; testimonials |
| Editor overload (WS, pack generation) | Medium | Medium | Generation workers; rate limiting; Redis queue for heavy jobs |
| Insufficient coverage of economy plugins | Medium | Medium | V1 = Vault only (covers the majority); V1.5 = additions based on demand |

---

## 23. Glossary

| Term | Definition |
|---|---|
| **Bundle** | Runtime artifact: signed .zip (config + resource pack) downloaded by the plugin from the CDN. Opaque to the admin, generated automatically by the backend. |
| **Pack** | Organization unit in the workspace (group of thematically linked menus + commands + templates + assets). Also: shareable export/import format `.itfz` (see `pack/v1` schema). |
| **Command** | Custom Artisan command, first-class entity alongside menus (see section 15). `command/v1` schema. Reuses the menu catalog's actions and conditions, plus a typed argument system. |
| **Argument** | Typed positional parameter of a command (`player`, `online_player`, `string`, `integer`, `number`, `boolean`, `world`, `enum` in V1). Automatic tab-completion according to the type. |
| **Menu context** | Named, typed slots that the menu declares via `Menu.contextInputs`. Each slot is populated at open time by auto-binding by name (from the caller: command args, parent menu's contextInputs, current iteration alias) or by a connector attached via `source: ConnectorBinding`. Explicit override via `OpenMenuAction.context`. See §15.4. |
| **ContextInput** | A slot of the menu context. `{ name, type, default?, source? }`. The `name` is exposed as `{name}` in any text field of the menu. |
| **ConnectorBinding** | Configuration of a connector attached to a `ContextInput`: `{ ref, params?, filter?, sort?, limit? }`. The `params` and `filter` values can interpolate `{name}` to reference other `contextInputs` of the menu. See §14. |
| **Auto-binding by name** | When a menu is opened via `open_menu`, each `contextInput` of the target menu is populated from a value of the same name in the current scope (command args, calling menu's contextInputs, iteration alias). Overridable by `OpenMenuAction.context`, disableable by `clear_context: true`. See §15.4. |
| **Workspace** | An admin's work space, containing their packs (Personal + user-created + imported + forked). |
| **Canvas** | The editor's multi-menu view (V1), a Figma-like infinite space where each menu is a preview card, and `open_menu` actions become auto-derived arrows. List/Canvas toggle in the toolbar. |
| **Slim pack** | Pack export mode: manifest + JSONs only, assets referenced by CDN URL. ~10-100 KB. Designed for embedding in a plugin JAR. |
| **Full pack** | Pack export mode: manifest + JSONs + binary assets. Self-contained. For marketplace or archive. |
| **Menu redirection (V2)** | Workspace-level mapping that redirects `openMenu(source_id)` to a different menu. Allows replacing a plugin menu with a fork without breaking call sites. |
| **registerMenuPack (V2)** | Third-party plugin API that lets a plugin provide full menus to the admin's workspace via an embedded slim pack. Namespace auto-derived from the calling plugin. |
| **Server key** | Unique key linking a Minecraft server to an editor account |
| **Live** | Version of a menu currently served to players |
| **Draft** | Version being edited by an admin, visible only to them via `/menu preview <id>` |
| **Staging** *(V1.5)* | Preview version of a menu, frozen and accessible to invited testers before publication. Out of MVP scope. |
| **Template** | Reusable named component (Figma Symbol style) |
| **Appearance** | Visual variant of an Element. Evaluated in order, the first whose `if` matches wins. If none matches → fall-through to the layer below. |
| **Layer** | Container that groups Elements in a menu. Layers are ordered bottom→top, rendered top→bottom with fall-through. |
| **CMD** | `custom_model_data`, Minecraft mechanism to assign an alternative model to an item |
| **CMD string** | Variant of CMD introduced in 1.21.4, using a string namespace instead of an int |
| **Pack stacking** | Minecraft capability (since 1.20.3) to stack several resource packs without conflict |
| **MiniMessage** | Standard text format of Adventure / Paper. XML-like tags (`<color>`, `<bold>`, `<gradient>`, `<click>`, `<hover>`...). Used for ALL text fields of menus and commands. Documentation: https://docs.advntr.dev/minimessage/format.html |
| **i18n key** | Hierarchical slug identifier (`menu.shop_main.btn_buy.title`) referenced via `{i18n:key}` in any text field. Scoped to the admin's workspace. `translations/v1` schema. |
| **Translation** | Value of an i18n key for a given language. MiniMessage format. Can contain PAPI placeholders and other i18n references. |
| **default_lang** | The workspace's reference language, guaranteed for every i18n key. Ultimate fallback if another language is missing at runtime. |
| **JSON schema** | Versioned intermediate format (`menu/v1`, `menu/v2`...) published as a product asset with TypeScript types and JSON Schema |
| **MCP server** | Model Context Protocol server (`artisan-mcp`) that exposes menu operations to AI clients (Claude Desktop, Cursor, etc.). V2 roadmap |
| **PluginIntegration** | Registration of a third-party plugin with the editor (component palette + suggested layouts) |
| **Component** | Component provided by a third-party plugin (single or paginable button, with placeholders and default action) |
| **Paginable component** | Component that occupies a row of slots and generates N instances dynamically |
| **Suggested layout** | Pre-filled menu offered by a third-party plugin as a starting point (purely indicative) |
| **component_ref** | Reference in a menu's JSON to a third-party component (e.g. `questx:quest_button`) |
| **Connector** | Code that implements a binding to a third-party plugin: queries the plugin, exposes a list (or a single object) of typed objects. Referenced by `namespace:source` (e.g. `chestshop:items`) from a `ContextInput.source`. Artisan homemade at V1, registered by the plugin author in V2. |
| **Iteration** | Mechanism by which an Element renders one slot per item of a `ContextInput` of type `"list"`, via `iterates: { source, alias }`. The `alias` is the local name of the current item, accessible in the Element's fields via `{alias.field}`. |
| **Pro** | Artisan's single paid subscription tier (€30/year or €80 lifetime): unlocks the custom resource pack hosting service (PNG upload → signed CDN), MCModels import, multi-server (5), AI 50/month (V1.5), unlimited version history, 50 GB storage, priority Discord support. Free remains usable with vanilla materials + Nexo/ItemsAdder/Oraxen integration + self-hosted resource pack. |
| **Founder rate** | Lifetime locked-in promo for early adopters: -30% on Pro during the first 3 months post-launch (extendable by 1 month if critical bugs). Pro founder = €21/year or €56 lifetime. |
| **Cloud mode** | The plugin's default operating mode (all tiers): connected to Artisan via WebSocket, live sync, bundle pull from the CDN, server-bound signatures. Enabled as soon as a valid `server_key` is configured. |
| **Local mode** | The plugin's opt-in offline mode (all tiers): reads `plugins/Artisan/menus/*.{json,yaml}` from disk, manual reload or file-watch. For admins who refuse any cloud dependency. |
| **`/artisan editor`** | In-game command that acts as a deeplink shortcut to the current workspace: opens the web editor on the right server context, using the browser's active session. Not a separate auth mechanism — an account remains required (Discord or email). |

---

## 24. Next steps

1. **Validate this spec** with the team / early users / targeted YouTubers.
2. **Calibrate Pro prices** via a mini-survey or benchmark.
3. **Editor prototype** (1-2 weeks) to validate drag & drop UX + live editing.
4. **Plugin POC** (1 week) to validate the 1.21.4+ resource pack pipeline with Nexo installed in parallel.
5. **Open a closed beta** (50-100 triaged admins) for the run-in before public launch.
