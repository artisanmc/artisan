---
title: Projects
description: Create a project on your Minecraft server.
---

Select a connected server, then choose **New project** in the sidebar or network page.
Enter a folder name such as `my_project`, then press **Enter** or click **Create**.
The name becomes the project's folder on the server and must not contain path separators.

Creation completes only after the server writes the project. If the server is offline,
does not respond, or already has a project with that name, the dialog shows an error
and keeps your input. After a timeout, check the project list before trying again.

## Drafts and publishing

Edits are automatically saved to a private backend draft. Sign in with the same
account on another browser to resume it. **Drafts** shows whether the save has
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

**Save** publishes the current draft to Minecraft. Automatic draft saving never
publishes. Changes made directly on the server are checked at publication; resolve
any file conflicts before retrying. Discarding changes also discards the backend
draft. Other drafts remain available.

If **Save** fails, a dialog shows the reason, the plugin's detailed message when supplied, the error code and the HTTP status
when available. Use **Copy details** to share the diagnostic, or select the text
if clipboard access is unavailable. Reopen it through the arrow beside **Save** →
**Last save error**. The error remains available until a successful save or until
you close the project. File conflicts still open the resolution dialog.
The red dot on the arrow specifically indicates an offline or conflicting draft
sync; hover over the arrow or open **Drafts** to inspect that state.
