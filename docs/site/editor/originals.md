---
title: Module originals
description: What a module ships stays the module's; your module folder only keeps what you changed or added.
sidebar:
  order: 12
---

A module (shops, guilds, quests…) ships its own menus, dialogs, commands and variants. Artisan
keeps them in the module's `originals/` folder, rewritten by the server each time it starts or
the module is updated. Your module folder only holds what you **changed** or **added**: for the
same id, your file wins over the original.

So a module you never touched has an almost empty folder, and every shipped document follows the
module's updates.

## In the editor

Select a document of the module: the properties panel says where it comes from.

| Badge | Means |
|---|---|
| **Module's version** | The shipped version. It follows the module's updates. |
| **Your version** | Your version of a shipped document. It wins over the module's. |
| **Added by you** | A document the module does not ship. |

On a modified document:

- **Compare with the original** shows the module's file beside yours, to copy what you need.
- **Back to the original** drops your version. Deploy to apply it.

To see the whole module as it ships, without your changes, tick **View as > Module original** on
the canvas toolbar. It combines with the variant chosen above it (the variant's shipped
versions, the module's elsewhere) and is read-only: look, copy what you need, untick it to edit.

Edit a document and it becomes yours; edit it back to what the module ships and it is the
module's again. Only documents that differ from the module's are written to your folder.

## Removing a shipped document

Delete a shipped example and Artisan remembers it in the module file, so it does not come back
at the next update:

```yaml
# artisan-module.yml
originals:
  exclude: [menus/top.yml]
```

Some menus and dialogs are **required**: the module's code opens them. They cannot be deleted;
change them instead.

## Updates

When the module is updated, the originals are replaced. A document you modified keeps your
changes and takes in what the module changed elsewhere in it. When you and the module changed
the same value, yours is kept and the log says so.

The `originals/` folder is read-only: the editor, AI apps and deploys never write into it. You can
read it on the server to see exactly what the module ships.
