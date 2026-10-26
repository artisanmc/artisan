# Artisan — Web editor spec

**Reference document for the design and development of the web interface**
Version: draft 1 (April 2026)

This document describes the capabilities that the `editor.artisanmc.net` web editor must offer. It complements the general product spec (`spec-plugin-minecraft-gui-editor.md`) by zooming in on the admin-side user experience. It describes **what must be possible**, not the exact visual appearance (left to design).

---

## 1. Overview

### 1.1 Personas and usage contexts

The editor serves three personas with different usage frequencies and needs:

- **The solo admin** (95% of the free tier): 1 personal or semi-pro server. Opens the editor a few times a month to adjust a shop menu or add a feature. Needs everything to be immediately understandable without reading docs. No patience for complexity.
- **The network admin** (main paying target): 2-10 servers, manages shared menus and per-server specific configs. Opens the editor several times a week. Needs efficiency (shortcuts, copy-paste, batch edit) and clear multi-server management.
- **The power user / plugin dev**: integrates their own plugin via the third-party API, or wants to edit complex configs. Needs Code mode and fine-grained visibility into the internals.

### 1.2 Three main functional areas

The editor is organized around three areas:

- **Dashboard**: overview of servers, menus, activity, usage. Entry point after login.
- **Menu editor**: the canvas where the admin builds their menus. This is where they spend 80% of their time.
- **Settings**: account, team, billing, parameters. Rarely visited but must be impeccable.

---

## 2. Guiding UX principles

The editor follows five principles that must guide all design decisions.

**Obvious first, powerful second.** The default layer (Visual) must be immediately understandable by a Minecraft admin who has never used a visual editor. Advanced features (conditions, view states, Code mode) are accessible but hidden behind a toggle. No feature toggle option at first login.

**Fearless editing.** Every change is revertable, autosaved, and preserved until publish. The admin must be able to tinker without fear of breaking something in production. The Live / Draft distinction is explicit and permanently visible.

**Immediate feedback.** Every action has a visible consequence in under 100ms. Dragging an asset, changing a title, toggling a condition — everything is real-time feedback on the canvas.

**In-game live-edit as the killer feature.** The admin can connect their game session to the editor and see their changes in real time in their open inventory. This is what makes the product magical in demos and day to day. The live connection status is permanently visible.

**Consistency with Minecraft culture.** The admin must find the game's conventions: materials named in upper snake case `DIAMOND_PICKAXE`, the `§a` color code format, `/` command formats, PAPI placeholder mentions `%player_name%`. No gratuitous reinvention.

---

## 3. Authentication and onboarding

### 3.1 Login

Minimalist landing page with two options:

- **"Login with Discord"** — standard OAuth. Recommended option (one click, no password to manage).
- **"Email + password"** — classic sign-up (email / password + confirmation). Validation email mandatory before activation. Recovery via a link sent to the email.

Both methods produce the same Artisan account. A Discord user can later add an email/password from their profile (and vice versa), to have both links. At first login, we ask Discord-only users for a recovery email — does not block immediate use (skip possible) but reminds the user after 24h.

### 3.2 Onboarding (first login)

3-step wizard for the very first use. Skippable but strongly recommended.

- **Step 1 — Link your first server**: The admin generates a "server key" (unique key). We give them two precise instructions: copy the key, add it to the plugin's `config.yml`. When the plugin connects via WS, the editor detects the connection and the server appears as "linked". A loader with a "waiting for connection" animation follows this step.
- **Step 2 — Discover the editor**: Spawn of a demo menu (`Example shop`) on the linked server. The admin types `/menu open shop_demo` in game and sees the menu. Meanwhile, we show them how to edit a slot in the editor (30-second interactive mini tour).
- **Step 3 — First menu on their own**: "Create my first menu" button. The admin chooses a layout (empty or a suggested one), names their menu, and lands on the canvas. Onboarding done.

### 3.3 Sessions and reconnection

7-day JWT session, transparent refresh. If Discord revokes access (ban), the session expires at the next validation with the message "Discord reconnection required". The admin can reconnect (and link a new Discord to their account if an email/password is configured in parallel). For email/password accounts, an HttpOnly refresh token (30 days) enables "remember me".

---

## 4. Dashboard / Home

### 4.1 Home page

Overview accessible from anywhere via a clickable logo. Shows:

- **Server selector** (dropdown at the top left): lets you switch between the servers linked to the account. With a single server, the selector stays but has only one option.
- **Connection status** of the selected server: "Connected · ws active" / "Disconnected · last sync Xmin ago" / "Plugin not started".
- **Menu list** of the selected server: grid with preview thumbnail, menu name, state (Live / Draft), last modified date, creator. Sort by date, by name, by state.
- **Quick actions**: primary button "New menu", secondary button "Import a config" (V2, but slot planned).
- **Recent activity**: feed of the latest changes published on this server (who published what when). Useful for teams.
- **Status widgets**: current storage usage (X / Y MB), number of menus created, alert if quota is close.

### 4.2 Server selector

Critical UX: the admin must always know which server they are working on. The selector is permanently visible in the header, with the server name displayed in plain text. Switching servers reloads the menu list, disconnects the WS of the previous server and reconnects to the new one's WS.

If the admin has a "dev" server and a "prod" server linked to the same account, they can:
- Work on dev (free editing in draft)
- Click "Promote to prod" on a menu to copy it as a draft to the prod server (V2 — useful but not MVP)

### 4.3 Loading states and empty states

- **No server linked**: big call-to-action "Connect your first server" that relaunches the onboarding wizard.
- **No menu**: "Create your first menu" + "spawn from suggested" gallery based on the detected third-party plugins.
- **Plugin disconnected**: persistent yellow banner "The plugin is not connected. Check that the server is started and that the server_key is correct."

---

## 5. Menu editor (the core)

### 5.1 General layout

The menu editor uses a 4-zone layout:

```
┌─────────────────────────────────────────────────────┐
│ Toolbar: menu name, save, publish, preview, etc.    │
├──────────┬───────────────────────────────┬──────────┤
│          │                               │          │
│ Palette  │   Canvas (inventory grid)     │ Properties│
│ (left)   │                               │ (right)  │
│          │                               │          │
│          │                               │          │
├──────────┴───────────────────────────────┴──────────┤
│ Status bar: WS status, autosave, last change        │
└─────────────────────────────────────────────────────┘
```

The left and right panels are collapsible (click on a button, or keyboard shortcut). The canvas is always visible and takes the remaining space.

### 5.2 Canvas — the inventory grid

1:1 visual representation of the Minecraft inventory (9 columns × 1 to 6 rows, depending on the menu's `size`).

**Canvas capabilities:**

- **Selecting a slot**: single click → the slot is selected (visual highlight), the right panel shows its properties.
- **Multiple selection**: Shift+click or Ctrl+click to add to the selection. Cmd+A to select all. Allows batch edit (change an asset on 5 slots at once).
- **Dragging an asset**: from the left palette to an empty slot → the asset is placed. If the slot is occupied, "replace?" prompt or auto-merge depending on the nature of the elements (asset + state preserved).
- **Dragging an existing slot**: dragging a slot onto another slot → swap or move (depending on the modifier key). Visual indicator during the drag.
- **Dragging a row**: for paginable components, the admin selects a row of slots (drag-select) then assigns a paginable component.
- **Right-click on a slot**: context menu (Copy, Paste, Save as template, Delete, Duplicate, See the default if linked to a suggested layout).
- **Keyboard delete**: Del/Backspace on a selected slot empties it.
- **Background**: background zone of the menu, click to select and change the background asset (if there is one). Configurable at the menu level, not at the slot level.
- **Third-party component slot indicator**: discreet visual badge (e.g. "QuestX") in the corner of the slot.
- **View states indicator**: badge "+2 states" if the slot has conditional states.
- **Template indicator**: badge "T" if the slot is an instance of a template, with a hover showing the template name.
- **Error indicator**: red slot with an explanatory tooltip if something is wrong (component unavailable, missing asset, etc.).

**Canvas controls:**

- **Menu size**: slider or stepper to go from 9 to 54 slots (1-6 rows). Warning if we shrink and non-empty slots would be lost.
- **Zoom**: Ctrl+scroll, or +/- buttons at the bottom of the canvas. Useful on small screens or for an overview.
- **Snap-to-grid**: active by default, always.
- **Visible grid**: toggleable. Shows the slot borders or not.

### 5.3 Left panel — Palettes

The left panel is a tabbed panel containing **several palettes** of elements to drag-and-drop onto the canvas.

**Tabs:**

- **Vanilla items**: all Minecraft materials, search by name (fuzzy), filter by category (blocks, tools, armor, food, etc.). Dragging an item → the slot receives `material: "DIAMOND_PICKAXE"` with the vanilla rendering.
- **My assets**: the images uploaded by the admin. Folders, tags, search. Drag → the slot receives `asset: "..."` with a default vanilla item (paper) and the custom_model_data appropriate to the generated pack.
- **Third-party plugins** (one tab per detected third-party plugin, e.g. **QuestX**, **ShopGUIPlus**, etc.): the palette of components declared by this plugin. Each component has a displayName, an icon, a mode (single/paginable). Drag → the slot receives a `component_ref`.
- **Nexo** (V1.5): Nexo items and textures detected on the server. Organized by category. Drag → `material: "nexo:..."`.
- **ItemAdder** (V1.5): same for ItemAdder.
- **Templates**: the symbols created by the admin. Drag → instantiates the template with a variables prompt.
- **Marketplace** (V2): purchased assets and menus.

**Palette controls:**

- Global search (shortcut `/` to focus the search).
- Filter by tag.
- "Show only used" toggle (useful for read-only sources like Nexo).
- "Upload assets" link at the top of the "My assets" palette that opens the upload modal.

### 5.4 Right panel — Properties

Shows the properties of the selected slot (or of the menu if no slot is selected). If several slots are selected, shows the common properties editable in batch.

**For a slot, sections (all accessible in a single unified mode, some via "+ Add X" buttons to keep the UI clean by default):**

- **Appearance** [always visible]:
  - Asset (file picker from the palette or inline upload)
  - Material (autocomplete on Minecraft materials + Nexo/ItemAdder namespaced ones)
  - Title (text input with Minecraft rendering preview, placeholder autocomplete)
  - Lore (multi-line textarea with preview, placeholder autocomplete)
  - Count (1-64)
  - Enchanted glow (toggle)
- **Click actions** [always visible, left click by default]:
  - List of atomic actions for the main click (Left)
  - Each action has its dedicated form (give_item → material + count; run_command → command + as)
  - "+ Add an action" button
  - "+ Add a condition" button → exposes the requirements panel inline
  - "+ Add a cooldown" button → exposes the cooldown form inline
  - "+ Add a fallback" button → exposes the fallback action chain inline
  - "+ Add another click type" button → adds Right / Shift-Left / Shift-Right / Middle
- **Conditions and requirements** [exposed via "+ Add a condition", inline]:
  - List of conditions (AND by default, toggle to OR, negation per condition)
  - For each condition: type + parameters with autocompletion
  - Nested composition if needed (AND groups inside an OR, etc.)
- **Cooldown** [exposed via "+ Add a cooldown", inline]:
  - Id, duration (e.g. "5s", "1m"), scope (player/server/permission_group), message if on cooldown
- **View states** [exposed via "+ Add a conditional state"]:
  - List of conditional states (reorderable by drag)
  - For each state: conditions (`if`) + appearance overrides (asset, lore, title, click)
  - "+ Add a state" button to stack
- **Third-party component** [auto-displayed if applicable]:
  - Shows the component used (e.g. "questx:quest_button") read-only with a "see in the palette" link
  - Toggle to use the component's default click action or define your own
  - Variables exposed by the component (read-only, for autocomplete in the lore)
- **Template** [auto-displayed if an instance]:
  - Shows the parent template
  - Local variables (editable)
  - "Detach" button to break the link
- **Tags** [accessible via "+ Tags"]: free tags for search/filter (e.g. "shop", "premium")

The expansion state of each section is remembered per account/menu — an admin who always works with their view states expanded finds them open at each session.

**For the menu (no slot selected), sections:**

- **Identity**: id (read-only after creation, auto-generated), name, description.
- **Appearance**: size (9-54), background (asset).
- **Open requirements**: conditions to validate in order to open the menu.
- **Open actions / Close actions**: actions to run when the menu opens/closes.
- **Permission**: permission required to open the menu via command.
- **Plugins used** (read-only): automatically computed list (`metadata.uses_plugins`).

### 5.5 Unified progressive-disclosure mode + JSON Export/Import

No "Visual / Advanced" toggle. A single unified editor that presents simple actions up front and exposes advanced capabilities via the "+ Add X" buttons and the expandable sections detailed in section 5.4.

Benefits vs a mode-based system:

- **Discoverability**: the "+ Add a condition", "+ Add a cooldown" buttons, etc. serve as implicit docs themselves. The novice admin learns by reading the UI.
- **No friction**: everything is one click away, not a mode-shift. Smooth workflow for novices and power users in the same session.
- **Simple architecture**: no global "active mode" state, no different layouts to design, a single DOM tree with collapsible sections.

Inspiration: Notion (slash commands), Linear (inline filters and options), Figma (cleanly nested panels).

For very complex modifications or power users used to working with an AI, the editor exposes three complementary capabilities:

- **Export JSON**: downloads the current menu as `.json`. Useful for sharing, Git versioning, external manipulation by script or AI.
- **Import JSON**: upload of a `.json` strictly validated against the versioned schema, then replaces the current draft. Validation errors clearly displayed with JSONPath path and reason.
- **View raw JSON**: read-only modal with syntax highlighting, "Copy to clipboard" button, and (V1.5+) "Open in Claude" / "Open in ChatGPT" deep link that pre-fills the context on the external AI side.

**Philosophy**: the visual editor remains the canonical surface. Power users who want to modify in JSON format export, modify elsewhere (manually or via AI), re-import. This separation simplifies the architecture and aligns with modern usage — AIs generate JSON cleanly with a well-documented schema, better than most humans with a YAML editor.

### 5.6 AI-ready by design

The JSON schema is treated as a central product asset:

- **Versioned** (`menu/v1`, `menu/v2`...) with migrations applicable at load.
- **Documented as TypeScript types + JSON Schema** published at `docs.artisanmc.net/schema`.
- **Annotated examples** for common patterns (simple shop, paginated menu with third-party component, view states, etc.).
- **Stable and explicit**: verbose, explicit field names rather than cryptic ones (`requirements` rather than `req`, `actions` rather than `act`).

This schema quality makes the use of external AIs (Claude, ChatGPT, Cursor, etc.) trivial from the MVP. On each export, the admin can prompt "here is my Artisan menu, add a has_money condition on this slot" and get valid JSON to re-import.

AI-native roadmap (V1.5+ and V2+) built on this base — see section 20.

### 5.7 Toolbar

At the top, left to right:

- **Logo** (click → dashboard).
- **Breadcrumb**: `Dashboard > Server > Menu name`.
- **Menu state**: colored badge (Live / Draft).
- **JSON buttons**: Export, Import, View raw (grouped in a dropdown menu if there is no horizontal room).
- **Undo / Redo** (icons + shortcuts Ctrl+Z, Ctrl+Shift+Z).
- **In-game preview**: "Preview" button that pops a toast "Type /menu preview shop_main in game to see your current version."
- **History**: clock icon → opens a drawer with the last 5 published versions + the session's autosave snapshots.
- **Save indicator**: "Saved 2s ago" or "Saving..." (autosave).
- **Publish**: primary button on the right, always visible. Click → confirmation dialog with a "what changes" preview and the final "Publish to live" button.

### 5.8 Status bar

At the bottom, thin, always visible:

- **WS status**: green dot "Live edit on" / red dot "Disconnected, working offline".
- **Connected server**: name of the server to which changes are pushed.
- **Player counter**: number of players online on the server (useful to know how many people are exposed to the menu).
- **Time since last sync**: "Last sync: 3s ago".
- **Hash of the current version**: first 8 characters of the draft hash (useful to tell co-admins which version we are looking at).
- **Admin username** + soft-lock indicator (if someone else is editing the menu, badge "@username2 viewing").

### 5.9 Live editing and collaboration

The editor permanently displays the state of the WebSocket connection. If the tunnel is active, each change is pushed to the plugin and visible in game.

**Live edit visible to the admin**:
- The admin types `/menu join_edit shop_main` in game on the server.
- The shop_main inventory opens in their Minecraft client, wired to the editor's draft.
- Each change in the web editor is reflected almost instantly in their inventory.
- The admin can test clicks; actions really execute (give item, take money, etc.) — they edit their own experience.

**Guest live edit (whitelist)**:
- The admin can invite other players in game: `/menu invite_edit shop_main @PlayerB`.
- PlayerB can then type `/menu join_edit shop_main` and sees the draft.
- Useful for validating together before publishing.

**Multi-admin soft-lock**:
- If another admin of the account opens the same menu in the web editor, they are shown a read-only view with the banner "@username1 is editing. [Take over]".
- Take over: confirmation, then control is switched. The other admin receives a notification "@username2 took over".
- No simultaneous Figma-style editing in the MVP.

---

## 6. Asset library

### 6.1 Overview

Page accessible from the dashboard and from the left panel of the editor. Grid view with asset previews, organized in folders and sources.

### 6.2 Sources (left sidebar)

Tree of asset sources:

- **My uploads**: what the admin uploaded.
  - User-created folders (drag-drop to reorganize).
  - Nestable sub-folders.
- **Imported**: assets imported from external packs.
  - One sub-folder per imported pack (e.g. "MCModels: FantasyShopPack").
  - Read-only at the organizational level (cannot reorganize, but can tag).
- **Plugin sources** (V1.5):
  - **Nexo**: organized by category declared in Nexo. Read-only.
  - **ItemAdder**: organized by namespace. Read-only.
- **Marketplace** (V2): purchased assets.

### 6.3 Main view (grid)

Responsive grid of assets with:

- Thumbnail (rendering of the asset, possibly with an "in-context" preview — e.g. in an inventory slot).
- File name.
- Metadata: dimensions, upload date, number of uses.
- Hover actions: detailed preview, edit (rename, tags), delete (with confirmation).

### 6.4 Search and filters

- Search bar with fuzzy matching on name, tags, folder.
- Filter by tag (multi-select).
- Filter by dimension (16×16, 32×32, etc.).
- "used / unused" filter: assets used in at least one menu vs unused (useful for cleanup).
- Sort: name, upload date, dimensions, usages.

### 6.5 Upload flow

- "Upload" button at the top right.
- Modal with drop-zone (multiple drag-drop) or file picker.
- For each file:
  - Validation: PNG only, max size 2 MB.
  - **Normalization preview**: "This image is 47×47px. It will be resized to 64×64. Here is the before/after preview." Toggle "Don't show again for similar cases".
  - Selection of the destination folder.
  - Tags (optional).
- "Upload all" button to launch the batch.
- Duplicate detection: if the MD5 hash already exists, prompt "This asset already exists under the name X in folder Y. [Overwrite] [Duplicate] [Skip]".

### 6.6 Drag-drop to the canvas

From the asset library grid (or from the left panel in the menu editor), the admin drags an asset directly onto a canvas slot. Visual animation during the drag (the target slot highlights).

### 6.7 Cleanup and quotas

- "Unused assets" view that lists assets without any reference in a menu.
- "Delete unused" button with confirmation and a counter of freed space.
- Quota indicator in the header (X / Y MB used). Turns orange at 80%, red at 95%.
- If quota reached: blocking modal on upload "You have reached your storage limit. [Cleanup] [Upgrade]".

---

## 7. User-defined templates

### 7.1 Overview

"Templates" tab in the editor's left panel, and a dedicated page in the dashboard for global management.

### 7.2 Creating a template

From the editor:

- Select a configured slot (asset + click + lore).
- Right-click → "Save as template".
- Modal: template name, description, choice of **variables** (the values that will be parameterizable).
  - For each attribute (asset, material, title, lore, action params), toggle "make this a variable".
  - For each variable: name (e.g. `prix`), type (string, number, material, item, permission), default value.
- The template is saved. The original slot becomes an instance of the template.

### 7.3 Using a template

- Drag from the "Templates" palette to a slot.
- Parameterization modal: fill in the variables (with autocomplete depending on the type).
- The slot becomes a linked instance.

### 7.4 Editing a template

- Click on a template in the palette or in the management page → opens the template editor.
- Modify the appearance or actions.
- On save, prompt: "This template is used in 12 menus, on 47 slots. Propagate the changes to all instances?" [Yes / No, save as new template].

### 7.5 Local override vs global edit

- On a template instance, the admin can locally override an attribute (e.g. custom lore for this slot only).
- The override is visible: the overridden field has a "modified locally" badge + "revert to template" button.
- Editing a variable attribute: prompt "Edit template (propagates) or local override?" the first time, then the admin can configure their default behavior.

### 7.6 Detaching

"Detach from template" button on an instance → the slot becomes independent, no more propagation.

### 7.7 Management page (dashboard)

- List of all templates with usage count, last modification, creator.
- Search.
- "Delete template" button (with confirmation, and option "convert all instances to standalone slots").

---

## 8. Third-party plugin integrations

### 8.1 Automatic detection

The editor displays in the left panel one tab per third-party plugin detected on the connected server. No manual action needed — it is synced via WS at boot.

### 8.2 View of a third-party plugin (dedicated palette)

For each plugin:

- Name and logo (if provided by the plugin).
- Installed version.
- "See suggested layouts" link that opens a gallery.
- List of available components: displayName, icon, mode (single/paginable), description.
- Search on components.

### 8.3 Spawn from suggested

- Gallery of suggested layouts (visual cards with preview).
- Click on a layout → modal "Create a menu from this suggested layout". Menu name, target server.
- The menu is created independently, the admin lands on the canvas to customize it.

### 8.4 Unavailability indicator

If a menu uses a component that is no longer declared (plugin update, removal), the slot shows:

- Visually greyed out with a warning icon.
- Tooltip "This component (`questx:old_filter`) is no longer available in the current version of QuestX. You can delete it or replace it."
- No publish blocking — the admin chooses.

### 8.5 Viewing the component in detail

Click on a component in the palette → drawer with:

- Full description.
- List of exposed placeholders (with example values).
- Default click action.
- Appearance defaults.
- Mini documentation provided by the third-party plugin.

---

## 9. Live / Draft workflow

### 9.1 Permanently visible states

In the editor toolbar, a colored badge indicating the state of the current menu:

- **Draft** (orange): unpublished changes, visible only to the admin in live editing via `/menu preview <id>`.
- **Live** (green): version served to players.

The badge changes automatically after publish.

> A third **Staging** state (frozen preview accessible to invited testers via the `menu.preview.<id>` permission) is planned for V1.5 when team workflows become a real use case. Out of MVP scope.

### 9.2 Publish (draft → live)

"Publish" button in the toolbar. On click:

- Modal "Publish this menu?" with:
  - Visual or textual diff of the changes compared to the current live.
  - Warnings if the third-party components used have a version that could be incompatible with another server of the account (multi-server case).
  - Optional "Description of this version" field (useful for the history).
  - Final "Publish to live" button.

### 9.3 In-game preview

"Preview" button → toast with instructions "Type `/menu preview shop_main` in game to see the current draft". The admin can then see the changes without publishing.

### 9.4 History and rollback

Drawer accessible from the clock icon in the toolbar:

- List of the last 5 published versions (date, author, description).
- "Rollback to this version" button on each entry → re-publishes that version as the new live (without destroying the intermediate versions, which remain in the history).
- Autosave snapshots of the current session at the top of the list (useful to recover accidentally deleted work).

### 9.5 Multi-admin soft-lock

Indicator visible at the top of the canvas if another admin has opened the menu:

- "@username1 is editing this menu" + Discord photo.
- "Take over" button (with confirmation).
- Read-only for the 2nd admin until they take over.

---

## 10. Server management

### 10.1 "Servers" page in settings

List of servers linked to the account.

Per server:

- Name (editable).
- Server key (hidden by default, "Reveal" to see, "Regenerate" to invalidate the old one).
- Connection status (live, last seen X min ago, never connected).
- Detected Minecraft version.
- Detected third-party plugins (summary).
- Applied tier (Solo/Network/Unlimited depending on the account).
- Optional tags (e.g. "prod", "dev", "staging").
- "Disconnect" button (revokes the key).
- "Configure" button → detailed config page (display name on the editor side, dev/prod env, etc.).

### 10.2 Adding a server

"Add server" button at the top. Modal:

- Server name.
- Tag (prod / dev / staging).
- Generates a server key, displayed with copy-paste instructions.
- "Waiting for connection" loader (until the plugin's first reconnection via WS).

### 10.3 Limits per tier

Counter of servers vs tier limit. If the limit is reached, "Add server" is blocked with an "Upgrade" CTA.

---

## 11. Team management

### 11.1 "Team" page in settings

(MVP: solo account + simple invitation. Elaborate multi-user in V1.5.)

List of account members with:

- Discord username + avatar.
- Role (Owner, Admin, Editor, Viewer).
- Date added.
- Last activity.
- "Remove" button (except for the owner).

### 11.2 Inviting a member

"Invite member" button. Two options:

- By Discord username: enter the username, the member receives an in-app invitation at their next login.
- By Discord role (V1.5): "All members with the @admin role on Discord server X". Configure once, automatic afterwards.

### 11.3 Permissions per role

- **Owner**: everything, including billing, account deletion.
- **Admin**: edits, publishes, manages members (except the owner).
- **Editor**: edits, cannot publish nor manage members.
- **Viewer**: read-only on everything.

---

## 12. Account and billing

### 12.1 "Billing" page

- Current plan: Solo / Network / Unlimited + detail (number of included servers, storage, etc.).
- Billing period: monthly / annual (annual = -15%).
- Next renewal.
- Payment method (card via Stripe).
- "Upgrade plan" / "Change plan" button.
- "Cancel subscription" button with confirmation and a reassuring message: "Your existing menus will keep working forever, even after cancellation. You just won't be able to push new changes."

### 12.2 Current usage

Visual counters:

- Linked servers (X / Y).
- Asset storage (X / Y MB).
- Number of menus.
- Number of team members.

### 12.3 Billing history

List of Stripe invoices with date, amount, status (paid, failed), PDF download link.

### 12.4 Upgrade flow

- "Upgrade" button from anywhere.
- Tier comparator on the pricing page.
- Stripe Checkout integration.
- After payment: redirect to the dashboard with the banner "Welcome to [Tier]! Your new features are unlocked."

### 12.5 Downgrade

- "Change plan" button → select a lower tier.
- Warning modal if the downgrade causes an overrun (e.g. 8 linked servers but downgrading to Solo which allows 1): "You must disconnect X servers before downgrading."
- Applied at the next billing cycle (no pro-rata).

---

## 13. Notifications and activity

### 13.1 Notification center

Bell icon in the header. Shows unread notifications:

- "@username1 published the Main Shop menu 5 min ago."
- "Storage quota at 92%."
- "QuestX has an update available (v2.1.0) — your menus keep working."
- "Your Dev server has been disconnected for 3h."
- Billing notifications (payment succeeded, failed, upcoming renewal).

### 13.2 Notification preferences

Dedicated page in settings. Toggle per notification type:

- Team activity (publish, changes).
- Quota (near limit, reached).
- Plugin updates (compatibility).
- Server connection (prolonged disconnections).
- Billing.

Optional email notifications for critical events.

---

## 14. Settings and profile

### 14.1 Profile

- Discord identity (read-only, "Reconnect Discord" link).
- Recovery email (editable).
- Display name (used in the multi-admin indicators).
- Avatar (auto-pulled from Discord, override possible).

### 14.2 Editor preferences

- Theme: Light / Dark / System.
- Language: FR, EN at minimum (extensible).
- Auto-save interval (default 10s, configurable).
- "Show normalization popup" toggle (refers to asset upload).
- "Show tutorial tooltips for new features" toggle (to display on freshly unlocked features).

### 14.3 Advanced

- Personal API token (for third-party integrations or custom exports).
- Export all my data (GDPR).
- Account deletion.

---

## 15. Help and support

### 15.1 Inline help

- "?" icon in the header → drawer with contextual docs.
- Search in the docs.
- Links to video tutorials (embedded from YouTube).

### 15.2 Developer docs (V1.5)

Link to `docs.artisanmc.net` for the third-party API docs.

### 15.3 Contact support

- "Contact support" button that opens:
  - Email pre-filled with the context (account, server, version) if offline.
  - Discord modal pointing to the #support channel.
- FAQ directly accessible.

### 15.4 Community

- Visible community Discord link.
- Link to the public feature requests / bug tracker.

---

## 16. Keyboard shortcuts

List of shortcuts available in the editor:

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + S` | Force save (autosave is active by default) |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + C` / `+ V` | Copy / paste a slot |
| `Ctrl/Cmd + D` | Duplicate selected slot |
| `Delete` / `Backspace` | Empty the selected slot |
| `Ctrl/Cmd + A` | Select all slots |
| `Esc` | Deselect |
| `Shift + click` | Add to selection |
| `Ctrl/Cmd + K` | Command palette (quick action search) |
| `/` | Focus search bar (palette) |
| `Ctrl/Cmd + P` | Publish (with confirmation dialog) |
| `Ctrl/Cmd + Shift + P` | In-game preview |
| `?` | Show the shortcuts cheat sheet |
| `[` / `]` | Toggle left / right panel |
| `Ctrl/Cmd + E` | Export JSON |
| `Ctrl/Cmd + I` | Import JSON |
| `Ctrl/Cmd + J` | View raw JSON |

---

## 17. System states and error messages

### 17.1 WS connection lost

- Discreet banner at the bottom of the canvas: "Live connection lost. Your changes are saved locally and will be pushed on reconnection."
- Automatic exponential reconnection.
- No blocking of editing (the admin can keep working offline).

### 17.2 Modification conflict (multi-admin)

- If the admin is read-only because of a soft-lock and tries to edit: tooltip "You are read-only. [Take over]".

### 17.3 Validation errors (Import JSON)

- If the imported JSON is invalid: error modal with a precise list of the problems (JSONPath path + reason).
- The current draft is not affected (transparent rollback).
- The admin can fix on the source side (manually or by re-prompting the AI) and retry the import.

### 17.4 Quota reached

- Blocking modal on upload: "Storage quota reached. [Cleanup unused] [Upgrade plan]".
- Soft notification at 80% (orange) then 95% (red).

### 17.5 Third-party plugin in error

- If a third-party plugin crashes at registration: its tab in the palette shows "Plugin error — components unavailable. See the server logs." No impact on other plugins.

### 17.6 Missing asset

- If an asset referenced in a slot was deleted: the slot shows a red placeholder "Missing asset" with a quick "Replace" button.

### 17.7 Bundle cannot be published

- If publishing fails (error on the editor or plugin side): explicit error toast + "See details" link that pops a drawer with the stack trace or the reason for the failure.

---

## 18. Responsive and accessibility

### 18.1 Targets

- **Desktop**: full experience, optimized for 1280px+ screens (the majority of admins). The canvas + panels are naturally wide.
- **13" laptop**: functional layout, collapsible panels to recover width.
- **Tablet**: best-effort. Editing is possible but less pleasant. To be documented.
- **Mobile**: not supported for editing in the MVP. Read-only view of menus + simplified dashboard possible. To consider in V2.

### 18.2 Accessibility

- Sufficient contrast (WCAG AA minimum).
- Full keyboard navigation (visible focus, logical tab order).
- Alt text on assets in the palette (generated from the file name).
- ARIA labels on actions and dynamic states.
- No reliance on color alone to communicate a state (e.g. error = red **+ icon**).

### 18.3 Internationalization

- I18n from the MVP (FR + EN).
- System ready for adding languages without refactoring (ES, DE, RU, ZH likely depending on the user base).
- Date/time format according to the locale.

---

## 19. Performance and UX

### 19.1 Performance targets

- **Time to interactive** at login: < 2s on fiber, < 4s on 4G.
- **Dragging an asset**: feedback in < 100ms.
- **Editing an attribute**: canvas update in < 50ms.
- **WS push to plugin**: visible in game in < 200ms.
- **Publish**: "publishing" feedback + completion in < 3s for a standard menu.

### 19.2 Key optimizations

- Code splitting to load only the used chunks (the editor itself is a big chunk).
- Lazy loading of assets in the palette (virtualization if many items).
- Debouncing of autosaves and WS pushes.
- Local cache of server configs (placeholders, permissions, materials).
- Preloading of asset thumbnails when hovering the palette.

### 19.3 UX when slow

- Skeleton loaders on any load > 200ms.
- Optimistic updates: changes appear immediately in the UI, the server sync is silent behind.
- If an operation fails: error toast + transparent auto-retry when possible.

---

## 20. MVP V1 vs V2+ spec

### 20.1 Included in MVP V1

- Discord OAuth or email/password login (both in V1).
- 3-step onboarding.
- Dashboard with server selector, menu list, recent activity.
- Full editor:
  - 9×N canvas with drag-drop, selection, multi-select, copy-paste.
  - Left panel with palettes: Vanilla items, My assets, Templates, detected third-party plugins.
  - Right panel with properties (appearance, click actions, conditions, view states, cooldown, tags).
  - Unified progressive-disclosure mode (expandable sections, "+ Add X" buttons).
  - Export JSON / Import JSON / View raw JSON (no embedded code editor).
  - Versioned, well-documented, AI-ready JSON schema (published at `docs.artisanmc.net/schema`).
  - Toolbar with save / publish / preview / history / undo-redo.
  - Status bar with WS status.
- In-game live editing (`/menu join_edit`).
- Multi-admin soft-lock.
- Asset library: upload, normalization popup, folders, tags, search, drag-drop, cleanup, quotas.
- Templates: creation, editing, variables, local override, detaching.
- Third-party plugin integrations: dedicated palette, spawn from suggested, unavailability indicator.
- Live / Draft workflow with history and rollback.
- Server management: add, configure, regenerate key, status.
- Basic team management: invite by Discord username, 4 roles.
- Billing: tiers, Stripe Checkout, history, downgrade, cancel.
- In-app notifications.
- Profile and preferences.
- Inline help + static docs.
- Keyboard shortcuts.
- I18n FR + EN.
- Light / Dark theme.
- Responsive desktop + laptop.

### 20.2 V1.5

- **Killer feature 1: Nexo and ItemAdder palettes** in the left palette, direct drag-drop of custom items.
- **Killer feature 2: integrated AI assistant** ("Ask AI" in the toolbar) that takes natural language ("add a button to buy a VIP rank for $500") and applies mutations to the menu's JSON via the Claude API. Marginal cost absorbed by the Network/Unlimited tiers.
- "Open in Claude" / "Open in ChatGPT" deep links from View raw JSON, which pre-fill the context on the external AI side.
- Team invitation by Discord role ("all @admin").
- Developer docs site (`docs.artisanmc.net`) with published JSON schema + annotated examples + TypeScript types.
- "Promote to prod" mode (copy a menu from a dev server to prod).
- Enriched history (visualization of diffs between versions).
- Email notifications for critical events.

### 20.3 V2+

- **Killer feature: `artisan-mcp` MCP server** that lets users of Claude Desktop, Cursor, MCP-enabled ChatGPT, etc. list, read, and mutate their Artisan menus from their usual tool ("in Cursor: edit my shop_principal menu to add X"). Strong AI-native differentiation vs the competition.
- Native marketplace (assets, menus, third-party integrations).
- Real-time collaborative editing (Figma-like).
- Auto-convert of zMenu / DeluxeMenus configs.
- Continuous refresh of view states (dynamic progress bars).
- Native variables (player/server/session scopes) with dedicated UI.
- Read-only mobile.
- More languages (ES, DE, RU, ZH depending on the user base).
- Public REST/GraphQL API for third-party automation.
- Built-in analytics on menus (who opens what, which buttons are clicked, where players drop off).

---

## 21. UX risks to validate in prototype

To be tested with 5-10 admins in 15-minute sessions during the prototype:

- **Understanding the slot concept**: does a Minecraft admin naturally "see" inventories as grids of slots?
- **Intuitive drag-drop**: is the drag mechanic from the palette to the canvas obvious without a tutorial?
- **Progressive disclosure**: are the "+ Add a condition" / "+ Add a cooldown" / etc. buttons visible enough to be discovered naturally, or too discreet and therefore invisible?
- **View states**: is the notion of conditional appearance graspable without training, or does it require specific onboarding?
- **Templates with variables**: do power users use them, or do they ignore the feature and copy-paste instead?
- **Live / Draft workflow**: confusion between the two states, or immediate clarity?
- **In-game live edit**: expected "wow" effect in demos, or perceived as a gimmick?
- **Quota and upgrade flow**: does the admin understand the freemium model when they hit a quota, or do they feel trapped?

These UX risks are the project's real unknowns (the tech is validated by NxMenu). To iterate in prototype before coding the final MVP.

---
