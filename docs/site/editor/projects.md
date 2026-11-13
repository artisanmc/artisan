---
title: Projects
description: Create, import, draft and publish projects on your Minecraft servers.
sidebar:
  order: 2
---

A **project** is a folder on a Minecraft server: `plugins/Artisan/modules/<folder>/`, or an
add-on's own folder in its plugin (`plugins/ArtisanConversations/artisan/`). Everything you build in the editor (menus, commands, dialogs,
images) lives in one.

```
plugins/Artisan/modules/
├── main/              ← your project "main"
│   ├── menus/shop.yml
│   ├── commands/spawn.yml
│   └── assets/…
└── …
plugins/ArtisanConversations/
└── artisan/           ← the conversations add-on's project
```

In a network, the editor also lists each leaf server's projects as `<server>.<folder>`, for
example `survie2.shop` (see [Network mode](../../network/concepts/#project-ids)). What you may
do depends on your permissions (`artisan.editor.view`, `.edit`, `.publish`, `.config`): see
[Open the editor](../../getting-started/open-the-editor/).

## How a change reaches the server

1. You edit. Every change is saved to your **private draft**, in the suite database. Nobody else
   sees it, and the server's files do not change.
2. You click **Deploy**. The editor shows every file it will write, with a line diff.
3. You confirm **Deploy to the server**. The server writes the files and reloads the project.

Saving, automatic or with the disk button, never deploys. Files edited by hand on the server
are picked up at `/artisan reload`.

## Create, rename, delete

| To… | Do | Note |
|---|---|---|
| Create | Pick a server, **New project**, type a folder name (`my_project`), **Enter** | The name becomes the folder: no `/`. Done only once the server has written it. |
| Rename | Project settings → **Edit** next to the ID | Drafts follow. A taken name is refused. Add-on projects cannot be renamed. |
| Delete | Project settings → **Delete project** | The folder moves to `.artisan-trash/`, drafts included. Move it back and `/artisan reload` to restore. |

The folder name is the project's ID, used as is in URLs (`boutique_addon`, not `Boutique Addon`).
The display name shown in the header is separate and can be changed in the settings. A leaf
server running an older Artisan must be updated before you can create, rename or delete there.

## Drafts

- **Save** (disk button) saves the draft now. It spins while saving; hover it for the state
  (unsaved, saved, local copy only, changed in another session).
- Same Minecraft account in another browser: you resume the same draft.
- The arrow beside **Deploy** → **Drafts**: create a named copy, switch drafts, or review a
  draft's changes against the server. A project can have several drafts.
- If another session changed your draft, the editor does not merge: make a copy to keep your work.
- Images you upload also stay in the draft until you deploy, and only you see them.
- **Discard** drops the current draft; other drafts stay.

## Deploy, and when it conflicts

**Deploy** refuses to overwrite a file someone changed on the server since your draft started.
The conflict dialog lists those files. Expand one to see a diff: red **−** lines are the
server's version, green **+** lines are yours. Choose **Keep mine** or **Take the server's** per
file, then **Apply**. Identical contents and line-ending-only differences are flagged as such.

If a deploy fails, a dialog gives the reason, the error code and **Copy details**. Find it again
under the arrow beside **Deploy** → **Last save error**. After a timeout, clicking **Deploy**
again confirms the earlier attempt and publishes your newer changes with it.

## Import a project from a ZIP

On a server page, **Import a project (.zip)**. The archive is a project export or the project
folder zipped as is; its folder name decides which project it targets. The import lands in a
private draft, so nothing changes until you deploy.

| Mode | Server files not in the archive | Files on both sides that differ |
|---|---|---|
| **Merge** (default) | Kept | You choose per file: **Keep import** or **Keep server** (tick "Keep this choice for all following files" to go faster) |
| **Overwrite** | Removed | The archive wins; a confirmation lists what changes |

Exports and imports never include private drafts or operation journals.

## Content that comes from a module

Add-ons can ship menus, commands and examples. They sit in the project like your own files,
with a puzzle icon.

**Menus and commands a module provides.** Edit them freely. As long as you have not touched one,
it follows each new version of the module. Once you edit it, your change stays, and new versions
still bring what they change elsewhere. **Reset** (in the `···` options) puts the module's version
back. You cannot delete or move them.

Example: the auction module declares `commands/ah.yml`. You rename `/ah` to `/hdv` and add a
sound before its `module_command` step. The next version of the module adds `/ah history`: it
shows up as `/hdv history`, and your sound stays.

The `module_command` step runs the module's code. It lists the arguments the module reads; leave
a field empty to pass what the player typed, or write a value or a `{placeholder}`. The
Arguments panel warns when you rename, remove or retype an argument the code reads.

**Examples.** **+ → From a module…** next to the project name lists each template's files and
their state: *Not added*, *Unchanged*, *Modified*, *Removed*, *New version*. **Add to project**
copies the missing files, **Update** refreshes the ones you never touched, **Reset to module
version** replaces one file (your version stays in Versions). Nothing is overwritten without
asking. **Open default version** shows the template as shipped: copy elements from it and paste
them on your board with Ctrl+V.

Upgrading from the old override files (`overrides/command/<module>.<command>.yaml`)? The server
moves your changes into the command files once and keeps the old files in
`.artisan/migrated/overrides-command/`.

## Use another project's images and items

**Captured items**, **Images**, **Resources** and the image picker start with a **Project** menu:
pick another project of the same server (read only), or **All other projects** to search them
all. Whatever you use is **copied** into your project first, so each project stays complete:

- An identical image or item already there is reused, never duplicated.
- A name already taken by a different image becomes `name_2`, `name_3`…
- The copy is a snapshot: if the original changes, copy it again.

The **Resources** tab manages the project's images and fonts. Filter by **Button images**,
**Menu images** (backgrounds, logos, frames), **Fonts** or **Unclassified**; **Use as** in an
image's details changes its classification without touching menus that already use it.

## Organize the board

- **Folders.** Select documents → **File in a folder** (new or existing, with a color).
  Double-click a folder's frame to show only it, **Escape** to show everything. Drag a document
  onto a frame, or in the sidebar onto a folder, to file it.
- **Rearrange** (toolbar) places groups by their links and keeps each group's inside as is.
  **Groups → name → Rearrange contents** tidies one group only.
- **Collections.** Some modules keep their documents in one list instead of the board, like the
  shop's **Catalog**. It has one sidebar entry: its page shows a card per document and **+**
  creates one.

Everything here supports Undo/Redo and is saved with the editor layout.

## When a server is offline

A leaf that disconnects stays listed as offline. Its projects cannot be opened, saved or
deployed until it reconnects; your browser keeps a recovery copy of unsaved edits meanwhile.
