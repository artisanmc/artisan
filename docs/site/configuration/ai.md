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
| Who pays the model | You, with your API key or your artisanmc.net credits | The player's own AI subscription |
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

**Another vendor.** Pick **OpenAI-compatible** and one of the known addresses (DeepSeek,
Mistral, OpenRouter, a local Ollama, which takes any key), or type another, then the model as the
vendor names it:

```yaml
ai:
  provider: "openai"
  api-key: "${DEEPSEEK_API_KEY}"
  base-url: "https://api.deepseek.com"
  model: "deepseek-chat"
```

**artisanmc.net credits.** Pick **artisanmc.net credits** and one of the models listed: no key
to paste. The calls go through artisanmc.net and are paid from the AI credits of the account
this network is linked to (the link of the **Updates** page). Everyone who uses this editor
spends that one balance, shown at the bottom of the sidebar; clicking it opens your account page
on artisanmc.net. When the balance reaches zero, the next message is refused. In
`environment.yml`:

```yaml
ai:
  provider: "artisan"
  model: "the id shown in the editor"
```

Not every model reads every file: DeepSeek reads text files only, PDFs go to Anthropic, OpenAI
and OpenRouter. The editor refuses another kind before sending.

**Use it.** Players with `artisan.editor.edit` open a project and click ✦, then describe what
they want:

> Make a /warps menu with 3 rows: spawn, shop and arena, each one teleporting the player.
> Use a compass for spawn.

The assistant reads the modules, starts a draft and writes the files, each one checked by the
server first. The panel offers to open the draft in **Drafts**, where you review and deploy.

- **Assistant tab** of the server page: the same conversation in full width, every file it wrote
  on the right (menus shown as in game, images enlarged, other files as YAML with a diff). It
  can work across all the server's projects, one draft each; **Review and deploy** takes them
  all.
- **Attach files** with the paperclip, or drop or paste them: up to 5 per message. Screenshots
  and textures (3.7 MB), PDFs (6 MB), text files such as another plugin's menu to convert
  (200,000 characters). 6 MB per message, 16 MB per conversation: start a new conversation for
  a new batch.
- **Translate the missing languages.** In a translatable field, open its translations and click
  "Translate the missing languages", or on the Translations page "Translate the N missing ones"
  for the whole module. A translation that loses a placeholder such as `{player}` is not written.
- A message runs at most `ai.max-steps` model calls, then stops and says so.
- Conversations survive restarts. Each player keeps their last 10, for 30 days.

Every message of every player is billed to your key, or to the linked account's credits.

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

**Images.** The app can also draw the images of a menu into the draft: buttons, icons and window
backgrounds, as pixel art it writes pixel by pixel or as a PNG it made on its side. It sees each
image enlarged after writing it, and can read the images a project already has to keep their
style. Ask for example: "Make the shop menu textured, in the style of the guild menus." An image
is at most 512 pixels on each side. Players see it once the draft is deployed and the resource
pack rebuilt. The editor's assistant gets the same tools and sees its images the same way, when
its model reads images (a text-only model draws without seeing, and says so).

**A menu as a picture.** The app can also look at a whole menu, deployed or in its draft: the
window, the title's images and texts, the image buttons and each slot's item. It uses it to
check a layout before telling you it is done. It is a still picture, not the game: conditions
and data are not evaluated, so an element shows its default look, a value such as
`{shop.price}` shows as `{price}`, and an item only known in game shows a `?`. Open the menu
in game, or in the editor's preview, to see it with real data.

**From a screenshot or a mock-up.** Attach a picture to your message in the editor's assistant
(a menu you like, a sheet of buttons, a mock-up) and ask for what you want from it: "Take the
close button and the three tabs from this picture." The assistant measures the picture, cuts
each element out at the art's own size, whatever the screenshot's GUI scale, removes the
background around a shape, and writes the result into the draft as an image, which it looks at
and corrects. It works best on pixel art over a plain background, in a PNG. The icons of an
inventory are told apart from its slots. A picture resized after the art was drawn (a store's
preview, a mock-up) is read too, less exactly: a JPEG or a resize blurs colours and edges, so
look at each image it gives. Art that is turned, or drawn in perspective, cannot be cut out.
Elements that touch their neighbours are cut as rectangles, to the pixel. A PNG, JPEG or GIF up to 2560x1600. An app
connected over MCP has no attachments: upload the picture into a module's images first, and
give it that path. Only take images you have the right to reuse.

**A consistent style: the UI kit.** Before it draws, the app looks at the images your modules
already have, so a new menu matches the others. To keep a style over time, ask it for a UI kit:
"Make a UI kit for this server from the guild menus." It creates a module named `ui-kit` that
holds the shared images (buttons, windows, arrows) and a `data/ui-kit.yml` file: the list of
those images, grouped as you like, and the style rules in plain words ("vanilla bevel, no black
outline"). Any menu of the server can use the kit's images, and the app reads the kit at the
start of each conversation, which is the only thing it remembers from the last one. The kit is
a module like any other: you review and deploy what the app adds to it, and you can edit the
file yourself.

**The kit's base.** Every server has a few plain images under names that never change: two
windows (`kit:window.6`, `kit:window.3`), four buttons (`kit:button.3x1` and its `danger`, `off`
and `plain` forms), a panel, a card, two value boxes, arrows, close, back and two toggles. A
menu that names them looks right on any server, which is what a module you share needs. Your
`ui-kit` module restyles one with an image of the same name and size ("redraw `button.3x1` of
the kit in the style of the guild menus"): every menu that names it follows. An image of another
size is left out, so that no menu is thrown off. Any other image of the `ui-kit` module is
`kit:<its name>` too.

**Composed images.** A window with its slots, or a card with its icon, does not have to be
drawn pixel by pixel: the app can put it together from kit images and the module's own ("a
window of 6 rows from the kit, with the guild icon in the title"). Such an image is a short
recipe (`compose:` in `assets/textures/<name>.yml`, no PNG beside it) that the resource pack
assembles at each build. It is used like any image, and it follows its layers: redraw the
kit's window, and every image composed with it changes at the next build. A layer is a kit
image or a PNG of the same module; the image is as large as its first layer, unless the recipe
gives a `width` and a `height`.

```yaml
# assets/glyphs/guild_window.yml
ascent: 13
codepoint: 57344
compose:
  - use: "kit:window.6"
  - grid: "kit:cell"      # 9 columns by 6 rows of slots
    x: 7
    y: 17
    columns: 9
    rows: 6
  - image: guild_icon     # a PNG of this module
    x: 80
    y: 4
```

**Deploying is off by default.** If you hold `artisan.editor.publish`, tick "Also let it deploy"
on the consent page, or the "Can deploy" switch in **Settings → AI apps**. The app then shows
the changes and deploys only after you say yes, with the same checks as the editor's Deploy.
Each deploy is a Version marked "<player> via <app>", and the app can roll a project back.

**Revoke.** **Settings → AI apps → Disconnect** cuts an app off at its next call. Losing
`artisan.editor.edit` in game cuts all of a player's apps.

**Requirements.** The AI provider must reach an HTTPS address: the tunnel server (the default)
works. Behind your own [reverse proxy](../web-server/#https-behind-a-reverse-proxy), pass `/mcp`,
`/oauth/` and `/.well-known/` to the editor with `X-Forwarded-Proto` and `Host`.
