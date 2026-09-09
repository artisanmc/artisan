---
title: AI Assistant
description: Describe a menu in plain language — or drop a zmenu / DeluxeMenus file — and let the assistant build it on your canvas.
---

The AI Assistant is a chat panel inside the editor that creates and edits menus
for you. Describe what you want in plain language, and the assistant writes the
menu straight onto your canvas — titles, slots, click actions and all. You can
keep chatting to refine it.

## Opening the panel

Open the **Assistant** tab in the Project workspace, then start a new
conversation or resume an existing one.

## Talking to the assistant

Type a request and press **Enter** (use **Shift + Enter** for a new line).
Examples:

- "Create a 27-slot shop menu with a diamond in the center."
- "Add a back button to the bottom-left of the current menu."
- "Rename the title to **Daily Rewards**."

As the assistant works, its reply streams in, and any menu it creates or changes
appears on your canvas immediately. A small line in the transcript notes each
menu it **created / updated** or **deleted** by id. Everything it does is part of
your normal edit history, so you can **undo** it like any other change.

## Importing from zmenu / DeluxeMenus

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

Choose **Migrate this selection**, then **Analyze selection**. There is no separate
credit budget to enter. Analysis indexes files and links without calling the AI.
Resolve duplicate or existing target names and review warnings before choosing
**Start migration**.

Source YAML does not have to be syntactically valid: when static analysis fails,
the AI receives the original text and attempts the conversion. A warning identifies
sources whose dependencies could not be indexed. Review repaired syntax and links;
generated Artisan menus still have to pass validation. Size/context limits remain.

Artisan converts one menu at a time, using bounded shared context and an index of
the other targets. **Pause after this menu** stops before the next menu; the
current one may finish. Reopening the same conversation shows saved progress
without restarting generation. **Resume migration** continues unfinished menus;
generated results are retained after interruptions or cancellation.

Use **Apply to draft** or **Apply available results**, review the menus, then
**Save** to publish. “Generation complete” does not confirm that every behavior
was migrated. Dynamic, external or missing links and command bindings require
manual review; unsupported results are blocked. Existing local menus are never
overwritten by this flow. If source files change, choose **Review sources and
target names**, then **Create new analysis**. Old results stay in history but are
not reused by the replacement run.

If one menu and its shared files exceed the context limit, review those files
manually; selecting all menus does not load every raw menu into each AI call.
If the browser reports that it cannot preserve the draft, save applied changes
before leaving. Generated proposals remain available in the migration history.
The storage check is a small availability probe, not a guarantee that the full
draft will fit in the browser's remaining quota.

## Requirements

When a migration pauses, the explanation includes its interruption code. A pause
does not necessarily indicate a connection problem: `missing_proposal` means the
AI returned no tool action, while `tool_batch_limit` means more than 256 actions
were requested in one response. Repeating a deterministic error may fail again.

The assistant needs an AI provider configured on the server side. If it isn't
set up, the assistant is unavailable — ask your server admin to configure a
provider. Nothing the assistant produces is published to your live server until
you **Save** the Project as usual.
