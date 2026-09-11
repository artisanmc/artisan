---
title: AI Assistant
description: Describe a menu in plain language — or drop a zmenu / DeluxeMenus file — and let the assistant build it on your canvas.
---

The AI Assistant is a chat panel that proposes menus, dialogs, commands and translations
from plain-language requests. Review its results, choose **Apply to draft**, then
**Save** to publish. You can keep chatting to refine your request.

## Opening the panel

Open the **Assistant** tab in the Project workspace, then start a new
conversation or resume an existing one.

## Talking to the assistant

Type a request and press **Enter** (use **Shift + Enter** for a new line).
Examples:

- "Create a 27-slot shop menu with a diamond in the center."
- "Add a back button to the bottom-left of the current menu."
- "Rename the title to **Daily Rewards**."

Once accepted, a task runs on the server even if you reload or close the page.
Reopen the conversation to recover its activity and results. **Stop** explicitly
cancels the task; losing the tracking connection does not cancel it. Elapsed time,
the current action and the activity log show progress. **Model reasoning** is
available when the provider supplies it; a responding server does not prove that
the model has produced new output. Errors preserve existing results without an
automatic paid retry. A backend restart can interrupt the worker and require an
explicit continuation; browser reloads do not.

To continue an interrupted task, send a new message in the same conversation.
Selected server file references are retained and reread with current permissions;
their raw contents are not stored in the conversation. A new server selection
replaces the previous one. Previous proposals remain available to the assistant.
If your draft is unchanged, the latest task includes the earlier unapproved
proposals so you can review and apply the complete set together.
While the provider streams reasoning, text or tool arguments, a slow task stays
active. Four minutes without provider activity interrupts the request without retry.

Files uploaded from your device are also retained for the lifetime of the conversation,
including files the assistant has not read yet. Reloading or sending another message
does not remove them. New uploads are added; uploading the same filename replaces its
contents. Removing a pending file before Send does not delete an earlier upload.
Uploads are private to this conversation and its authorized Project scope, and are
removed with the conversation. Storage allows 200 files, 1 MiB per file and 8 MiB
total (including JSON encoding); these are storage limits, not model context limits.
Uploads lost before this update cannot be recovered automatically.

Changes are proposals, not immediate edits. **Apply to draft** checks that your
draft has not changed since the task started. Review conflicts instead of
overwriting newer work; **Save** remains the publishing step.

## Importing from another menu plugin

Have an existing menu from another plugin? **Drag the `.yml` file onto the chat
panel**, or choose **📎 → From my device** next to the message box to pick
files. Local attachments are listed above the composer with their name and size;
click the **×** on a file to remove it. You can send attached files without
typing anything — **Send** is available as soon as a file is attached. The
assistant reads the attached files
and uses them as the basis for the menus it builds. This is the fastest way to
migrate a DeluxeMenus or zmenu layout into Artisan.

### Files already on the Minecraft server

Choose **📎 → From the server**, select a configured source such as **zMenu**,
then check files or folders. Selecting a folder includes all its compatible
descendant files and preserves their relative paths. Search helps locate menus;
**Refresh** reloads the available files. Check the file count and size, then
click **Attach**. Each source appears as an expandable group above the composer;
you can remove a group or reopen the selector to change its selection.

Local and server files can be sent together, with or without a message. Server
files are read when you press **Send**. A file added after selection is not
automatically included. Imports are read-only: Artisan never changes the source
menus. Limits are **200 server files**, **1 MiB per file**, and **8 MiB total**,
in UTF-8 text. If a file cannot be read, the message and attachments stay in the
composer; no AI turn starts and no credits are charged. Refresh or adjust the
selection before retrying.

After **Send**, a loading indicator beside the composer shows that files are
being sent and Artisan is waiting for the assistant. This can take longer with
many files. Your draft stays visible until the response starts; the assistant's
activity indicator then takes over.

If a response is interrupted or fails, click **Retry** below the error to resend
the same message and attachments in the same conversation. Local file contents
are retained; selected server files are read again. A new draft you have started
is preserved. Retrying starts a new AI turn and uses credits normally; it never
runs automatically. The retry selection is kept only while this conversation
stays open, and is cleared after a successful response or a new message.

The server administrator must configure [import sources](/getting-started/install-admin/)
in the plugin configuration. An empty selector means no valid source is available.
When the server is offline, **From the server** is disabled and **From my device**
remains available. If the server does not respond, retry after checking that it
is connected and running an up-to-date Artisan plugin.

### Migrating a linked zMenu selection

For a linked set such as 35 menus, keep the complete server selection, including
shared patterns. The configured import source must expose those files: a source
rooted at `plugins/zMenu/menus` cannot expose sibling pattern directories. When
needed, ask your administrator to configure an allowed source such as
`plugins/zMenu`, then select the needed menus and shared files, preserving relative
`patterns/`, `action_patterns/` or `actions_patterns/` paths. Do not select unrelated
plugin configuration files.

Attach the complete selection and describe the goal in chat, for example:
"Migrate this configuration into Artisan, including the menus, dialogs, commands
and translations needed to preserve its behavior."

The same assistant tools handle creation, editing and importing. There is no
special migration tool or mandatory menu-by-menu conversion plan. The model
chooses which sources and dependencies to inspect, which artifact types to
produce and in what order. Malformed source text is readable without a YAML
analysis gate; generated artifacts still have to pass Artisan validation.
Unsupported behavior must be explained rather than silently discarded.

Use **Apply to draft**, review all proposed changes, then **Save** to publish.
Results are not proof of behavioral equivalence: check navigation, commands,
permissions, dialogs and external plugin dependencies on your server.

Existing migrations remain available in **Earlier migrations** with their saved
menus and legacy resume/compression controls. New chat requests do not restart
that workflow. Their source references can be reused by ordinary chat, subject
to the same access checks. Legacy **Compress and resume** applies only to those
older migrations; ordinary chat does not silently compress its history.

## Requirements

The provider enforces context capacity. Errors preserve completed proposals.
Output limits and validation remain separate safeguards; truncated output is not
executed. If a task is interrupted, inspect the reported cause before requesting
continuation. Stop and page reload behavior are unchanged.

The assistant needs an AI provider configured on the server side. If it isn't
set up, the assistant is unavailable — ask your server admin to configure a
provider. Nothing the assistant produces is published to your live server until
you **Save** the Project as usual.
