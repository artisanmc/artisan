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
| Pictures from an image model | Asks you before each one | Off by default; the player can allow it |

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

### Generated pictures

The assistant draws pixel art itself: buttons, icons, windows. What it cannot draw pixel by
pixel (an illustration, a painted background, a detailed emblem) it can ask of an **image
model**, when you set one. In **Settings → Assistant**, under **Image model**, pick OpenAI or
Google and paste that vendor's API key. Or in `environment.yml`:

```yaml
ai:
  image:
    provider: "openai"
    api-key: "${OPENAI_API_KEY}"
```

- **Each picture is paid on that key**, a few cents each depending on the model. So the
  assistant asks first: a card in the conversation shows what it is about to ask for, with
  **Allow once**, **Always allow** and **Deny**. "Always" is yours alone, for this tool; take it
  back in **Settings → AI apps**. A question left unanswered for five minutes counts as a no.
- **A player gets `ai.image.daily-limit` pictures a day** (40 unless you change it), the
  assistant and their AI apps together.
- **The picture is material, not a file.** It comes back at about a megapixel and shows in the
  conversation. The assistant then measures it and cuts out what the menu needs, at the size it
  needs, into a draft, the same way as from a screenshot you attach. The server keeps each
  player's last 8 pictures while it runs.
- **Pixel art from an image model is approximate**: its pixels are rarely on a true grid.
  Buttons, slots and small icons come out better drawn by the assistant itself. Use an image
  model for what is painted.
- OpenAI's models make a transparent background when asked. Google's do not: the picture comes
  on a flat colour, which is removed when it is cut.

**Without a key: artisanmc.net credits.** When the network is linked to an artisanmc.net
account, pick **artisanmc.net credits** under **Image model** instead (or `provider: "artisan"`
in `environment.yml`, with no `api-key`). The site's image models are listed with their price
in credits per picture, taken from the linked account's balance each time a picture is made; a
refused or failed picture costs nothing. With no model picked, the first one the site offers is
used. Everything above still applies: the question before each picture, the daily limit.

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

Where the server has an image model ([Generated pictures](#generated-pictures)), the consent
page offers one more box: **let it ask the server's image model for pictures**. Off unless you
tick it, since the server's owner pays for each one; you switch it per app in
**Settings → AI apps** ("Can generate pictures"). An app that does its own image generation
does not need it: it can write the PNG it made with `write_image`.

**Images.** The app can also draw the images of a menu into the draft: buttons, icons and window
backgrounds, as pixel art it writes pixel by pixel or as a PNG it made on its side. It sees each
image enlarged after writing it, and can read the images a project already has to keep their
style. Ask for example: "Make the shop menu textured, in the style of the guild menus." An image
is at most 512 pixels on each side. Players see it once the draft is deployed and the resource
pack rebuilt; the pack's status names the images a module writes that the server lacks, so the
app can tell a name it got wrong. The editor's assistant gets the same tools and sees its images the same way, when
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

**A consistent style: the common images.** Before it draws, the app looks at the images your
modules already have, so a new menu matches the others. To keep a style over time, ask it for
common images: "Make common images for this server from the guild menus." It fills the server's
common images (`plugins/Artisan/themes/artisan/`, which every server has) with the shared images
(buttons, windows, arrows) and a `data/ui-kit.yml` file: the list of those images, grouped as you
like, and the style rules in plain words ("vanilla bevel, no black outline"). Any menu of the
server can use these images, and the app reads that file at the start of each conversation, which
is the only thing it remembers from the last one. You review and deploy what the app adds there
as you do for a module, and you can edit the file yourself.

**The base.** Every server has a few plain images under names that never change: two
windows (`window.6`, `window.3`), four buttons (`button.3x1` and its `danger`, `off`
and `plain` forms), a panel, a card, two value boxes, arrows, close, back and two toggles. A
menu names one by its name (`image: { asset: button.3x1 }`) and looks right on any server, which
is what a module you share needs. Your server restyles one with a common image of the same name
and size ("redraw the common `button.3x1` in the style of the guild menus"): every menu that
names it follows. An image of another size is left out, so that no menu is thrown off. Any other
common image of the server is named the same way. A module that holds an image of that name
shows its own in its menus; `artisan:button.3x1` names the common one there. The app writes the
name alone, and `artisan:<name>` in that case and in a composed image's layers; `kit:<name>`,
which it wrote before, is still read. The base itself is on the server, in
`themes/artisan/originals/`.

**An add-on's images.** A module that comes from an add-on ships its images, and the app may
redraw one under the same name. When the module says what the image is for (a menu image of a
fixed size, a glyph of a fixed height), a redraw at other measures is left out and the
module's own shows, as for the base. The app is told so when it writes such an image, with the
measures to draw it at, the list of a module's files names the images left out, and the menus
it shows you are drawn with what the game shows.

**Composed images.** A window with its slots, or a card with its icon, does not have to be
drawn pixel by pixel: the app can put it together from common images and the module's own ("a
common window of 6 rows, with the guild icon in the title"). Such an image is a short
recipe (`compose:` in `assets/textures/<name>.yml`, no PNG beside it) that the resource pack
assembles at each build. It is used like any image, and it follows its layers: redraw the
common window, and every image composed with it changes at the next build. A layer is a common
image (`artisan:window.6`) or a PNG of the same module; the image is as large as its first
layer, unless the recipe gives a `width` and a `height`.

```yaml
# assets/glyphs/guild_window.yml
ascent: 13
codepoint: 57344
compose:
  - use: "artisan:window.6"
  - grid: "artisan:cell"  # 9 columns by 6 rows of slots
    x: 7
    y: 17
    columns: 9
    rows: 6
  - image: guild_icon     # a PNG of this module
    x: 80
    y: 4
```

You can then move its layers by hand: the image's detail in the Resources page is a composer
(see [Image buttons](../../editor/image-buttons/), "Composed images").

**Themes.** A theme gives the common images another look, for a season or an event, without a
menu being touched ("make a Christmas theme: red buttons, snow on the windows"). It is a
folder of its own beside the common images, `plugins/Artisan/themes/noel/`, which the
assistant creates when you ask for a new theme (or you, with **New theme** in **Resources**,
common images):

```text
assets/textures/window.6.png   # the theme's image of that name: it replaces the common one, at its size
```

The assistant writes it into a draft of the theme, which you deploy like any other draft.
A theme changes the common images only: an image a module holds itself is changed in that
module ("redraw the guilds banner with snow" goes into a draft of `guilds`).

A theme may hold images of its own too, which no module and no common image has: a garland
for the winter look ("draw a garland in the theme noel and put it at the top of the shop").
The assistant writes it in the theme's draft (`assets/textures/garland.png`) and names it
with the theme in the menu, `noel:garland`. It shows as drawn while the server has the
theme, in place or not.

An image a theme draws is shown as drawn. A theme no longer repaints colours: a colour table
(`overrides/colors.yml`), its `scope` and `ramps: true` on an image are no longer read. A
drawing of another size than the image it replaces is left out, so the menus keep their
layout.

A theme written before themes had their own folder (`themes/<name>/` inside the common
images, with a `theme.yml`) moves to its own folder at the server's next start, its files put
at the places above; it keeps its name and its place in the stack, and the pack does not
change. A theme's folder holds no menu, command or Trigger: the server reads none from it.
The server's themes in place are a stack (`resource-pack.themes` of `config.yml`, the lowest
first): each changes what the ones below show, so the highest that redraws an image wins. Put a theme in place from **Resources** (the list of places on the left, **Put in place**), which sets it above the others and rebuilds
the pack; the same list holds the themes in order, where a theme is dragged to
another place. The
app cannot put a theme in place; it shows you a menu in a theme before you do.

**Deploying is off by default.** If you hold `artisan.editor.publish`, tick "Also let it deploy"
on the consent page, or the "Can deploy" switch in **Settings → AI apps**. The app then shows
the changes and deploys only after you say yes, with the same checks as the editor's Deploy.
Each deploy is a Version marked "<player> via <app>", and the app can roll a project back.

**Revoke.** **Settings → AI apps → Disconnect** cuts an app off at its next call. Losing
`artisan.editor.edit` in game cuts all of a player's apps.

**Requirements.** The AI provider must reach an HTTPS address: the tunnel server (the default)
works. Behind your own [reverse proxy](../web-server/#https-behind-a-reverse-proxy), pass `/mcp`,
`/oauth/` and `/.well-known/` to the editor with `X-Forwarded-Proto` and `Host`.
