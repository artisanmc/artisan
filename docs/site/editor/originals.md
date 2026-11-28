---
title: What a module ships
description: A module's files sit in its folder, editable in place; those you leave as shipped follow the module's updates.
sidebar:
  order: 12
---

A module (shops, guilds, quests…) ships its own menus, dialogs, commands, variants and messages.
Artisan writes them into the module's folder, each at its own path, like the files you add:
open `menus/main.yml` and edit it, there is nothing to copy first.

Beside them, `artisan-shipped.yml` records what each file was written from. Artisan writes it;
do not edit it. It is how a file's state is known:

| State | Means |
|---|---|
| **Module's version** | As shipped. It follows the module's updates. |
| **Your version** | You changed it. A module update merges into it. |
| **Added by you** | A file the module does not ship. |

## In the editor

Select a document of the module: the properties panel says where it comes from. On a modified
document, **Compare with the original** shows the module's file beside yours, and **Back to the
original** puts the module's version back (deploy to apply it). **View as > Module original**
shows the whole module as it ships, read-only. The module's versions are read from the server
(or, with the server off, from what the editor last fetched): until they arrive, the panel says
nothing.

Edit a document back to what the module ships and it is the module's again. A file reformatted
without a change of value stays the module's; a comment you add makes it yours.

## Removing a shipped document

Delete a shipped example and it stays deleted: Artisan lists it in the module file so it is not
written again at the next update.

```yaml
# artisan-module.yml
originals:
  exclude: [menus/top.yml]
```

Some menus and dialogs are **required**: the module's code opens them. Deleted, they come back
at the next start, with a warning in the log; change them instead.

## Updates

At each module update, a file you left as shipped takes the new version. A file you modified
keeps your changes and takes in what the module changed elsewhere in it. When you and the module
changed the same value, yours is kept, the log says so, and the file is compared again at the
next update. A file the module no longer ships is removed if you left it as shipped, kept
otherwise.

Messages are one file per language, `lang/<code>.yml`: the module's new keys are added and the
ones it changed are updated, unless you changed them.

## Upgrading from `originals/`

Folders of an earlier Artisan kept what the module shipped in `originals/`. The first start of
this version moves each one into the folder itself and removes `originals/`, after checking
that the server loads the same menus and builds the same pack from both. If something would
differ, the folder keeps `originals/` for now (the log says why) and the move is tried again at
the next start.

For AI apps: `list_documents` gives each document's origin, `read_document` with
`shipped: true` reads the module's version, and `restore_document` puts it back in a draft.
