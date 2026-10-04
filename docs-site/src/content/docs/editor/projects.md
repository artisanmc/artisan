---
title: Projects
description: Create projects on a Minecraft server or in Artisan hosting.
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

## Access to an existing network

Sign in before opening another network's projects. Google sign-in returns you to the page you originally opened. In invitation mode, request
access or accept an invitation from a network manager. If a server administrator
has enabled console access, copy the displayed `artisan member add <email>`
command and run it in the console of a listed server. The server must be online.
This gives your account member access to **the entire network**, including all
its projects; the page opens automatically after authorization. Invitations are
still available in console mode. See [server configuration](/wiki/getting-started/install-admin/).

## Try without an account

Choose **Try the demo** on the editor landing page. A temporary project opens in
the same canvas, with a bilingual example menu. You can edit menus, upload images
and fonts, and save private drafts. AI and Minecraft server actions require an account.

Temporary files, assets and private drafts are stored in Artisan's backend storage.
The browser cookie contains only an opaque access token, not the project itself.
Deleting that cookie or losing access to that browser prevents guest recovery.

The banner shows its expiry: **24 hours without an effective change**. Opening
or refreshing the editor does not extend it. At expiry, guest access is revoked
and the project is scheduled for cleanup; files are not necessarily deleted immediately.

The demo is for trying things out. To keep what you made, choose **Export this
project**: the editor confirms pending changes, then downloads a ZIP of your current
draft, images included.

## Create on a Minecraft server

The editor header shows the project's display name and updates when you edit it
in project settings. The Boutique module's project is named **Boutique** by
default; a custom display name is preserved.

Select a connected server, then choose **New project** in the sidebar or network page.
Enter a folder name such as `my_project`, then press **Enter** or click **Create**.
The name becomes the project's folder on the server and must not contain path separators.

On a connected server, creation completes only after the server writes the project.
If it does not respond, or already has a project with that name, the dialog shows an
error and keeps your input. After a timeout, check the project list before trying again.

A server that is not linked yet, or offline, can still receive new projects: the project
starts as your private draft, with nothing written on a server. Link the server with
`/artisan link`, then **Deploy**: the first publication creates the project's folder.
Prepare your menus this way before installing the plugin.

## Importing a project from a ZIP

Choose **Import a project (.zip)** on a server page, or on the server's card in the
network page. Artisan reads the archive, takes the project's folder name from its
manifest, and looks for a matching project on that server.

The import always lands in a **private draft**; nothing reaches the server until you
**Deploy**. If the project does not exist yet, it is created as a draft-only project
and its first deployment creates the folder. If it already exists, imports work in
one of two ways:

- **Merge** (default) — keep what the server has, add the archive's files, and choose
  file by file where both sides hold a different version. Server files the archive
  does not contain are kept.
- **Overwrite** — the archive becomes the new state; server files it does not contain
  are removed.

Conflicts are compared against the server's **current snapshot** (the last version
Artisan received), so a project can be imported while its server is offline. Each
conflict is shown as a Git-style diff; choose **Keep import** or **Keep server** per
file. Tick **Keep this choice for all following files** to apply one choice to the
remaining conflicts. Images that differ are resolved by identity, without a line diff.

In **Overwrite** mode there is nothing to choose: a confirmation screen shows the files
the archive will replace (with their diffs) and lists the server files that will be
removed, then **Apply import** writes the archive as is.

The archive is a full project export, or the project's folder zipped as-is. Private
working data — drafts and operation journals — is excluded, as at export.

## Opening a project while its server is offline

When its server is offline, a project still opens from the last version Artisan received
from that server; the banner shows its date. Your draft stays editable and saved, and
**Deploy** waits until the server is back. The editor checks again every 15 seconds.
A project Artisan never received a copy of does not open until its server responds.

## History

The **History** view (clock icon in the top bar, shortcut `6`) lists every version the
server loaded, newest first. A **Deployment** was published from the editor and shows who
deployed it; a **Server edit** means files were edited directly on the server, then
reloaded. **See changes** opens the diff of that version against the previous one.
**Restore into my draft** replaces your draft's text files with that version's; images
are left as they are, and nothing reaches the server until you deploy.

## Drafts and publishing

Edits are automatically saved to a private draft in the project's active storage.
The disk button (**Save**) saves that draft to your account immediately, without
touching the server. It spins while saving and turns inactive once your account holds
the latest version. Hover it to see the draft state: unsaved, saved, local copy only, or
changed in another session.
Sign in with the same account on another browser to resume it while that storage is available. **Drafts** shows whether the save has
been confirmed; a local copy is retained while a request is pending or unavailable.
Old browser drafts are uploaded separately so they do not replace existing work.

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
**Deploy to the server**. Saving a draft, automatically or with **Save**, never deploys. Changes made directly on the server are checked at publication; resolve
any file conflicts before retrying. Discarding changes also discards the private
draft. Other drafts remain available.

Asset uploads and changes also stay in the private draft until **Deploy**. Their previews
are visible only to the draft owner; sharing an exported project does not share that draft.

If **Deploy** fails, a dialog shows the reason, the plugin's detailed message when supplied, the error code and the HTTP status
when available. Use **Copy details** to share the diagnostic, or select the text
if clipboard access is unavailable. Reopen it through the arrow beside **Deploy** →
**Last save error**. The error remains available until a successful save or until
you close the project. File conflicts still open the resolution dialog.
After a timeout, retrying **Deploy** confirms the earlier attempt and also publishes
your newer changes in the same action. Changes made during publication remain in your draft.
The red dot on the arrow specifically indicates an offline or conflicting draft
sync; hover over the arrow or open **Drafts** to inspect that state.
During a draft storage migration, **Drafts** reports that saving is paused.
Shared project ZIPs exclude private drafts and operation journals, while retaining
the editor layout. Hosted ZIP imports preserve image and font bytes in one transaction.

## Create without a server, then copy to Minecraft

Open a hosted project and choose **Copy to Minecraft**. Select an authorized,
connected server with the matching Minecraft version and required modules, then
choose a free project folder. Existing folders are never overwritten.

If your draft has unapplied text or asset changes, choose **Copy the saved version**
to leave it untouched, or **Apply my current draft, then copy**. Apply waits for
pending uploads. Edits arriving after application remain in your source draft.
The copy includes the saved images and fonts, but excludes private drafts and history.

Once confirmed, Artisan opens the new server project. It is independent: future
changes are not synchronized with the hosted source. If confirmation is interrupted,
reopen **Copy to Minecraft** and choose **Check and resume**, including after refreshing
this browser. The same operation keeps its destination and saved version. A confirmed
failure lets you prepare another copy; reconnect an offline destination before retrying.

If the project is copied but its resource pack is not ready, choose **Retry resource
pack** to finish preparing images and fonts using the same operation. This does not
create another copy. You can also open the copied project separately while preparation
is pending.

## Comparing save conflicts

When files changed on the server, expand a file in the conflict dialog to see a
Git-style diff. Red **−** lines belong to the **server version**; green **+** lines
belong to **your version**. Unchanged lines provide context and both versions have
line numbers. The first file opens automatically.

Identical contents, missing files, and changed line endings (LF/CRLF or a missing
final newline) are indicated explicitly. Choose **Keep mine** or **Take the
server's** for each file, then **Apply**. Opening a diff does not resolve it.

## Project folders and renaming

An ordinary project's folder determines its file identity. The manifest no longer
needs `project_id`. Add-on projects keep the identity registered by their add-on
and cannot be renamed in the editor. Boutique uses `boutique_addon`.

Project URLs use this exact ID: `/projects/boutique_addon`, without replacing
underscores or changing case. Server projects are scoped by Network and Server;
hosted projects by Network. Different locations can contain the same ID.
The account-free demo opens at `/demo/projects/demo`, using your current session.

On the server overview, **Rename project** is available when the connected plugin
supports it. Choose a free folder name using letters, numbers, underscores or
hyphens. Renaming through Artisan updates the URL and preserves private drafts, history
and relationships. Old links redirect when they identify one project in that
location; a current folder ID takes precedence over a historical alias.
If the displayed name matches the old folder ID, it follows the rename in the
sidebar and project properties. A separate custom display name is preserved.
Renaming its folder manually is discovered as a different project.

If the connection drops, the rename stays pending. **Retry** checks the same
operation, including after refreshing this tab. A reserved or occupied target
requires another name. Open editors retain unsaved work while their identity is
updated and the server state is checked again.

ZIP imports use the enclosing project folder as the project's identity, rather than an
old manifest ID. See [Importing a project from a ZIP](#importing-a-project-from-a-zip)
above.
