---
title: AI Assistant
description: Describe a menu in plain language — or drop a zmenu / DeluxeMenus file — and let the assistant build it on your canvas.
---

The AI Assistant is a chat panel inside the editor that creates and edits menus
for you. Describe what you want in plain language, and the assistant writes the
menu straight onto your canvas — titles, slots, click actions and all. You can
keep chatting to refine it.

## Opening the panel

Click the **✨ (Sparkles)** button in the workspace top bar. A chat panel slides
in from the right. On a phone it covers the screen; on desktop it sits alongside
your canvas.

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
panel**, or click the **📎 (paperclip)** button next to the message box to pick
files. Attached files are listed above the composer with their name and size;
click the **×** on a file to remove it. You can send attached files without
typing anything — **Send** is available as soon as a file is attached. The
assistant reads the attached files
and uses them as the basis for the menus it builds. This is the fastest way to
migrate a DeluxeMenus or zmenu layout into Artisan.

## Requirements

The assistant needs an AI provider configured on the server side. If it isn't
set up, the assistant is unavailable — ask your server admin to configure a
provider. Nothing the assistant produces is published to your live server until
you **Deploy** as usual.
