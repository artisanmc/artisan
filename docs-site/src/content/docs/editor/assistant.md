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

## Requirements

The assistant needs an AI provider configured on the server side. If it isn't
set up, the assistant is unavailable — ask your server admin to configure a
provider. Nothing the assistant produces is published to your live server until
you **Save** the Project as usual.
