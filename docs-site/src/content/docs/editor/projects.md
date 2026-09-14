---
title: Projects
description: Create projects on a Minecraft server or in Artisan hosting.
---

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
**Save** updates the saved project; it does not run the project in Minecraft.

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
during the outage are checked for conflicts when you save.

## Drafts and publishing

Edits are automatically saved to a private draft in the project's active storage.
Sign in with the same account on another browser to resume it while that storage is available. **Drafts** shows whether the save has
been confirmed; a local copy is retained while a request is pending or unavailable.
Old browser drafts are uploaded separately so they do not replace existing work.

Open the arrow beside **Save**, then **Drafts**, to create a named copy, choose another draft, or compare its files
with the version it started from. Multiple drafts can belong to the same project.
If another session changed your draft, create a copy to preserve your local work.
If a version mismatch has identical local and remote contents, synchronization
clears it automatically without creating a copy or writing to Minecraft.
The editor does not automatically merge or overwrite concurrent changes.
Draft management stays in this menu; normal autosaving adds no status block to
the toolbar. A small indicator on the arrow flags a conflict or unconfirmed save.

**Save** publishes the current draft into its project's storage. Automatic draft saving never
publishes. Changes made directly on the server are checked at publication; resolve
any file conflicts before retrying. Discarding changes also discards the private
draft. Other drafts remain available.

Asset uploads and changes also stay in the private draft until **Save**. Their previews
are visible only to the draft owner; sharing an exported project does not share that draft.

If **Save** fails, a dialog shows the reason, the plugin's detailed message when supplied, the error code and the HTTP status
when available. Use **Copy details** to share the diagnostic, or select the text
if clipboard access is unavailable. Reopen it through the arrow beside **Save** →
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

## Project folders and renaming

An ordinary project's folder determines its file identity. The manifest no longer
needs `project_id`. Add-on projects keep the identity registered by their add-on
and cannot be renamed in the editor.

On the server overview, **Rename project** is available when the connected plugin
supports it. Choose a free folder name using letters, numbers, underscores or
hyphens. Renaming through Artisan keeps the project's links and private drafts.
Renaming its folder manually is discovered as a different project.

If the connection drops, the rename stays pending. **Retry** checks the same
operation, including after refreshing this tab. A reserved or occupied target
requires another name. Open editors retain unsaved work while their identity is
updated and the server state is checked again.

ZIP imports use the enclosing project folder rather than an old manifest ID.
If an archive contains `manifest.yaml` directly at its root, the import dialog
asks you to choose the destination folder before importing.
