---
title: Projects
description: Create, import, draft and publish projects on your Minecraft servers.
sidebar:
  order: 2
---

The **Buttons** panel beside the canvas contains **Game items**, **Captured items**
and **Images** for placing buttons in menus. The separate **Resources** project
tab manages shared button images, menu images and fonts.
One image can have both uses without uploading another copy.
Resources offers **All**, **Button images**, **Menu images**,
**Fonts** and **Unclassified** filters. In an image's details, **Use as** selects
its uses. Menu images include backgrounds, logos, frames and separators.
Existing images are classified from their menu usage when possible; images with
no known use appear under **Unclassified**. Changing classification does not remove
images already placed in menus.
Resource changes stay in your private draft until **Deploy**, like other edits.

Each project has its own frame on the server-wide canvas. Inside a project, only manual groups have frames. Select two or more documents — menus, commands or dialogs, mixed if you like — then choose
**Group selection** (also available on right-click), name the group and choose its color.
The background, including the header, uses that color at 15% opacity. Drag a group's header to move its documents together.
Click its name or use **Groups → Edit group** to change its name or color. You can also dissolve groups. Dissolving
keeps the documents. A document belongs to one group within its project; groups cannot be nested.
Groups always stay open, including groups saved as collapsed in older versions. Changes support Undo/Redo and
are saved with the editor layout. The server-wide canvas groups by project too;
editing stays in each project.

**Rearrange** on the canvas toolbar moves groups as whole blocks, using their incoming
and outgoing links to place them alongside ungrouped documents. It preserves every
group's internal arrangement. To rearrange only one group's documents, choose
**Groups → group name → Rearrange contents**. The group stays in place and its frame
resizes to fit; other groups and documents stay where they are. Both actions support Undo/Redo.

## Where projects live

Every project lives on a Minecraft server's disk, in `plugins/Artisan/projects/<folder>/`
(or in the folder an add-on registers). The editor is served by the plugin itself:
type `/artisan editor` in game and open the single-use link it prints. What you can do
depends on your permissions (`artisan.editor.view`, `.edit`, `.publish`, `.config`);
see [Open the editor](/wiki/getting-started/open-the-editor/).

In a network of servers, the editor lists the hub's own projects and those of every
connected leaf server. A leaf's project is named `<server>.<folder>`, for example
`survie2.shop`. See [Network mode](/wiki/network/concepts/#project-ids).

## Create a project

The editor header shows the project's display name and updates when you edit it
in project settings. The Boutique module's project is named **Boutique** by
default; a custom display name is preserved.

Select a connected server, then choose **New project** in the sidebar or server page.
Enter a folder name such as `my_project`, then press **Enter** or click **Create**.
The name becomes the project's folder on the server and must not contain path separators.

Creation completes only after the server writes the project. If it does not respond,
or already has a project with that name, the dialog shows an error and keeps your
input. After a timeout, check the project list before trying again.

## Importing a project from a ZIP

Choose **Import a project (.zip)** on a server page. Artisan reads the archive, takes
the project's folder name from its manifest, and looks for a matching project on
that server. The server must be online.

The import always lands in a **private draft**; nothing reaches the server's published
files until you **Deploy**. If the project does not exist yet, its first deployment
creates the folder. If it already exists, imports work in one of two ways:

- **Merge** (default) — keep what the server has, add the archive's files, and choose
  file by file where both sides hold a different version. Server files the archive
  does not contain are kept.
- **Overwrite** — the archive becomes the new state; server files it does not contain
  are removed.

Conflicts are compared against the server's current files. Each conflict is shown as
a Git-style diff; choose **Keep import** or **Keep server** per file. Tick **Keep this
choice for all following files** to apply one choice to the remaining conflicts.
Images that differ are resolved by identity, without a line diff.

In **Overwrite** mode there is nothing to choose: a confirmation screen shows the files
the archive will replace (with their diffs) and lists the server files that will be
removed, then **Apply import** writes the archive as is.

The archive is a full project export, or the project's folder zipped as-is. Private
working data — drafts and operation journals — is excluded, as at export.

## When a server is offline

A leaf server that disconnects from the hub stays listed as offline. Its projects
cannot be opened, saved or deployed until it reconnects; your browser keeps a
recovery copy of unsaved edits in the meantime.

## Drafts and publishing

Edits are automatically saved to your private draft. Drafts are stored in the suite
database (see [Database](/wiki/configuration/database/)) and belong to the player who
opened the editor. The disk button (**Save**) saves the draft immediately, without changing
the published files. It spins while saving and turns inactive once the server holds
the latest version. Hover it to see the draft state: unsaved, saved, local copy only, or
changed in another session. Open the editor with the same Minecraft account from
another browser to resume it. A local copy is retained while a request is pending
or the server is unreachable.

Open the arrow beside **Deploy**, then **Drafts**, to create a named copy, choose another draft, or review its changes
against the server. Each changed file shows a colored line diff, like `git diff`. Multiple drafts can belong to the same project.
If another session changed your draft, create a copy to preserve your local work.
If a version mismatch has identical local and remote contents, synchronization
clears it automatically without creating a copy or writing to Minecraft.
The editor does not automatically merge or overwrite concurrent changes.
Draft management stays in this menu; normal autosaving adds no status block to
the toolbar. A small indicator on the arrow flags a conflict or unconfirmed save.

**Deploy** first opens a review of every file it will write: new, deleted, modified and
renamed files, with their colored diffs. Nothing is written until you confirm
**Deploy to the server**. Saving a draft, automatically or with **Save**, never deploys.
Changes made directly on the server are checked at publication; resolve any file
conflicts before retrying. Discarding changes also discards the private draft.
Other drafts remain available.

Asset uploads and changes also stay in the private draft until **Deploy**. Their previews
are visible only to the draft owner; sharing an exported project does not share that draft.

If **Deploy** fails, a dialog shows the reason, the plugin's detailed message when supplied, the error code and the HTTP status
when available. Use **Copy details** to share the diagnostic, or select the text
if clipboard access is unavailable. Reopen it through the arrow beside **Deploy** →
**Last save error**. The error remains available until a successful save or until
you close the project. File conflicts still open the resolution dialog.
After a timeout, retrying **Deploy** confirms the earlier attempt and also publishes
your newer changes in the same action. Changes made during publication remain in your draft.
Shared project ZIPs exclude private drafts and operation journals, while retaining
the editor layout.

Files edited by hand on the server are picked up at `/artisan reload`.

## Comparing save conflicts

When files changed on the server, expand a file in the conflict dialog to see a
Git-style diff. Red **−** lines belong to the **server version**; green **+** lines
belong to **your version**. Unchanged lines provide context and both versions have
line numbers. The first file opens automatically.

Identical contents, missing files, and changed line endings (LF/CRLF or a missing
final newline) are indicated explicitly. Choose **Keep mine** or **Take the
server's** for each file, then **Apply**. Opening a diff does not resolve it.

## Project folders

A project's folder name is its identity. The manifest no longer needs `project_id`.
Add-on projects keep the identity registered by their add-on. Boutique uses
`boutique_addon`. Project URLs use this exact ID, without replacing underscores or
changing case; different servers can hold the same ID.

To rename a project, open its settings and choose **Edit** next to its ID. The folder is
renamed on the server and keeps its private drafts; a name already used by another project
is refused. Add-on projects cannot be renamed. A folder renamed by hand on the server
appears under its new name at `/artisan reload`.

**Delete project** in the project settings moves the folder to `.artisan-trash/` in the
server's projects folder, drafts included; nothing is erased, so an administrator can move
it back and run `/artisan reload`. A leaf server running an older Artisan must be updated
before projects can be created, renamed or deleted on it.

ZIP imports use the enclosing project folder as the project's identity, rather than an
old manifest ID. See [Importing a project from a ZIP](#importing-a-project-from-a-zip)
above.
