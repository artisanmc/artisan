---
title: Importing another plugin's data
description: Bring the data of the plugin you replace into a module, from the editor, with a dry run first and a way back.
sidebar:
  order: 13
---

A module that replaces another plugin can take over its data: Artisan Auctions reads zAuctionHouse
and AuctionHouse, Artisan Quests reads BeautyQuests. You run these imports from the **Imports**
tab of a server's page in the editor. The tab shows with the permission `artisan.editor.config`.

The import runs on the server that holds the data, so that server must be online. The same imports
exist in game as [`/artisan import`](../configuration/commands-permissions/).

## Import

1. Open the server's page, then **Imports**. Each line is a source one of your modules can read.
2. Click **Dry run**. The server reads the other plugin's data and writes nothing. The report
   says what would be imported, what is left aside and why, and what you should check afterwards.
3. Click **Import** when the report suits you. The data is written and the run gets a batch id.

The **Import** button stays off while the plugin you import from is still running on the server:
remove its jar and restart first, otherwise both plugins could hand out the same items. A dry run
works in the meantime.

A source that reads a file (a module's own import format) lists the files of
`plugins/Artisan/imports/` on the server. Put the file there, then reload the page.

Running an import again only writes what is not there yet.

## Undo an import

In **History**, an import has an **Undo…** button. It first runs a dry run of the rollback and shows
what would be removed. **Undo this import** then removes what the import wrote and nobody touched
since. What a player changed in the meantime (a listing bought, a quest moved forward) is kept and
listed.

If an import stops on an error, it is in the history as failed. What it wrote before stopping is
kept under its batch: running the import again resumes, and **Undo…** removes it.
