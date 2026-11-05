---
title: AI assistant & clients
description: Let an AI build menus and commands for you, from the editor's assistant or from Claude, ChatGPT and other MCP clients.
sidebar:
  order: 8
---

Two ways to let an AI edit your projects. Both write into a **draft**: you review the changes and
deploy, as with your own edits.

| | The editor's assistant | AI clients (MCP) |
|---|---|---|
| Where you type | The ✦ button in the editor | Claude, ChatGPT, an IDE… |
| Who pays the model | You, with your API key | The player's own AI subscription |
| Turn it on | **Settings → Assistant**: model + key | `web.mcp: true` in `environment.yml` |
| Can it deploy? | Never | Off by default; the player can allow it |

Both are previews.

## The editor's assistant

**Turn it on.** In **Settings → Assistant** (needs `artisan.editor.config`), pick a model and
paste an API key. It applies to the whole network, without a restart. The key stays on the hub
and is never shown again, only its last four characters. Or in the hub's
[`environment.yml`](../environment/#ai), which wins over the editor:

```yaml
ai:
  provider: "anthropic"
  api-key: "${ANTHROPIC_API_KEY}"
```

**Use it.** Players with `artisan.editor.edit` open a project and click ✦, then describe what
they want:

> Make a /warps menu with 3 rows: spawn, shop and arena, each one teleporting the player.
> Use a compass for spawn.

The assistant reads the modules, starts a draft and writes the files, each one checked by the
server first. The panel offers to open the draft in **Drafts**, where you review and deploy.

- **Assistant tab** of the server page: the same conversation in full width, every file it wrote
  on the right (menus shown as in game, other files as YAML with a diff). It can work across all
  the server's projects, one draft each; **Review and deploy** takes them all.
- **Attach files** with the paperclip, or drop or paste them: up to 5 per message. Screenshots
  and textures (3.7 MB), PDFs (6 MB), text files such as another plugin's menu to convert
  (200,000 characters). 6 MB per message, 16 MB per conversation: start a new conversation for
  a new batch.
- **Translate the missing languages.** In a translatable field, open its translations and click
  "Translate the missing languages", or on the Translations page "Translate the N missing ones"
  for the whole module. A translation that loses a placeholder such as `{player}` is not written.
- A message runs at most `ai.max-steps` model calls, then stops and says so.
- Conversations survive restarts. Each player keeps their last 10, for 30 days.

Every message of every player is billed to your key.

## AI clients (MCP)

With `web.mcp: true` in `environment.yml`, the editor's address also answers the
[Model Context Protocol](https://modelcontextprotocol.io) at `/mcp`.

1. In the editor, **Settings → AI apps** shows the address to copy, for example
   `https://survie.artisanmc.app/mcp`.
2. Add it as a custom connector in your AI app.
3. The app opens Artisan's consent page. Sign in as usual (`/artisan editor`), check which app
   asks, and allow it.

The app then acts as you, with your editor permissions minus `artisan.editor.config`. It needs
`artisan.editor.edit`. It can list servers and projects, read files and schemas, start a draft
and write into it; each file is checked by the server before it enters the draft.

**Deploying is off by default.** If you hold `artisan.editor.publish`, tick "Also let it deploy"
on the consent page, or the "Can deploy" switch in **Settings → AI apps**. The app then shows
the changes and deploys only after you say yes, with the same checks as the editor's Deploy.
Each deploy is a Version marked "<player> via <app>", and the app can roll a project back.

**Revoke.** **Settings → AI apps → Disconnect** cuts an app off at its next call. Losing
`artisan.editor.edit` in game cuts all of a player's apps.

**Requirements.** The AI provider must reach an HTTPS address: the tunnel server (the default)
works. Behind your own [reverse proxy](../web-server/#https-behind-a-reverse-proxy), pass `/mcp`,
`/oauth/` and `/.well-known/` to the editor with `X-Forwarded-Proto` and `Host`.
