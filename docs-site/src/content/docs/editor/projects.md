---
title: Projects
description: Create projects on a Minecraft server or in Artisan hosting.
---

## Access to an existing network

Sign in before opening another network's projects. Google sign-in returns you to the page you originally opened. In invitation mode, request
access or accept an invitation from a network manager. If a server administrator
has enabled console access, copy the displayed `artisan member add <email>`
command and run it in the console of a listed server. The server must be online.
This gives your account member access to **the entire network**, including all
its projects; the page opens automatically after authorization. Invitations are
still available in console mode. See [server configuration](/getting-started/install-admin/).

## Try without an account

Choose **Try the demo** on the editor landing page. A temporary project opens in
the same canvas, with a bilingual example menu. You can edit menus, upload images
and fonts, and save private drafts. AI, importing another project, and Minecraft
server actions become available only after keeping the project in an account.

Temporary files, assets and private drafts are stored in Artisan's backend storage.
The browser cookie contains only an opaque access token, not the project itself.
Deleting that cookie or losing access to that browser prevents guest recovery.

The banner shows its expiry: **24 hours without an effective change**. Opening
or refreshing the editor does not extend it. At expiry, guest access is revoked
and the project is scheduled for cleanup; files are not necessarily deleted immediately.
Browser recovery copies stay scoped to that guest session.

Choose **Keep this project** before expiry. The editor first confirms pending
text and asset writes, then offers sign-up or sign-in. Select an existing Network
or create one, and confirm. Project identity, private drafts and assets are preserved.
An interrupted claim can be retried after refresh with the same account. If access
to its destination is lost, select another Network. No files are sent to Minecraft
until you later use **Copy to Minecraft**.

## Create on a Minecraft server

The editor header shows the project's display name and updates when you edit it
in project settings. The Boutique module's project is named **Boutique** by
default; a custom display name is preserved.

Select a connected server, then choose **New project** in the sidebar or network page.
Enter a folder name such as `my_project`, then press **Enter** or click **Create**.
The name becomes the project's folder on the server and must not contain path separators.

Creation completes only after the server writes the project. If the server is offline,
does not respond, or already has a project with that name, the dialog shows an error
and keeps your input. After a timeout, check the project list before trying again.

## Create without a Minecraft server

Open your Network and choose **Create without a server**. Enter a project name,
folder name and Minecraft version; the Vanilla template is available initially.
Hosted projects keep their files and private drafts in Artisan storage. They use
the same editor and previews, and remain accessible while Artisan is available.
Live server data, inventory capture and in-game execution require a Minecraft server.
**Deploy** updates the saved project; it does not run the project in Minecraft.

**Import ZIP** explicitly creates a new hosted project in the selected Network.
The import keeps images, fonts and editor layout bytes. Exported archives include
published files and binary assets, but exclude private drafts and operation journals.

## Opening a project while its server is offline

A server project opens only after its server responds. Cached files and local
draft backups remain preserved until you reconnect; they do not unlock offline opening.
If the connection drops while a project is already open, its editing buffer stays
available. The notice explains that saving is suspended until reconnection.

The editor retries every 15 seconds while the server is unreachable. After a
successful read, the notice disappears automatically, including when the server's
files have not changed. Unsaved edits are preserved; changes made on the server
during the outage are checked for conflicts when you deploy.

## Drafts and publishing

Edits are automatically saved to a private draft in the project's active storage.
The disk button (**Save**) saves that draft to your account immediately, without
touching the server. It spins while saving and turns inactive once your account holds
the latest version; hover it to see its state.
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

ZIP imports use the enclosing project folder rather than an old manifest ID.
If an archive contains `manifest.yaml` directly at its root, the import dialog
asks you to choose the destination folder before importing.
