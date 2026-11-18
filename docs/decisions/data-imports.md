# Importing a competitor's data — one contract in Artisan, deterministic importers in the modules

**Status:** proposed (2026-11-18). Asked by Iban on 2026-11-18: established servers hesitate to
adopt a module when their data sits in a competitor's format. Auctions already imports
zAuctionHouse v3 and v4 (`artisan-auctions`, `importer/`); this ADR turns that importer into the
suite's contract and says what Artisan adds around it.

## Context

A server that runs zAuctionHouse, BeautyQuests or a guilds plugin has listings, money owed,
progress and ownership in that plugin's format. Losing them is not an option, so a module without
an import path is a module the server does not install.

Two kinds of things are imported, and they do not need the same machinery:

- **Content** (quests, dialogues, NPC cases, menus): files an admin reviews. Artisan already has a
  reviewed path to the disk: a draft, the diff, Deploy (ADR `mcp-server`, `server-identity-and-versions`).
- **Data** (active listings, items and money to claim, sales history, quest progress, land and guild
  ownership): rows with value for a player, written while the server runs, never reviewed one by one.

The facts that constrain the design:

- Data has value. A listing imported twice duplicates an item; a refund lost is money lost. The
  write must be **replayable, testable and identical on every run**.
- The module's write and its bookkeeping must be **one transaction** (crash mid-import = resume,
  never half a record). Only the module holds that transaction: Artisan cannot.
- An admin of an established server will not give an AI write access to a production database.
- Each module's records (a listing, a claim, a land) and each competitor's storage are specific;
  only the run around them (dry run, report, confirm, rollback, entry points) is common.

## Decisions

1. **Content imports into a draft, data through an importer.** A converter of content alone
   writes Documents into the admin's draft, reviewed and deployed like any other change; it does
   not use this contract. Everything below is about data. **Exception: content the imported data
   points to.** Players' quest progress is rows keyed by the uid of a quest: an importer that
   writes them needs the quests loaded when it does. Such an importer (`msquests:beautyquests`)
   writes the Documents itself, in its module's own folder, as new files only (an existing file it
   did not write blocks the run), records each with its hash in its ledger, and calls
   `api.project.reload()`; its rollback removes a file only while the hash still matches and no
   imported row still uses it. The admin reviews them in the editor after the fact, and the dry run's
   report lists what was converted, set aside and not carried.
2. **The run is Artisan's contract, the records stay the module's.** `modules.api.importing`:
   `api.getImports()` (`ImportRegistry`) takes an `ImporterDeclaration` per source
   (`<module>:<source>`, e.g. `auctions:zauctionhouse`, `auctions:json`): a label, the names of
   the plugins that must not be running, and an `Importer` with three blocking calls:
   - `plan(ImportRequest)` — read the source, convert, count, write nothing;
   - `apply(ImportRequest)` — the same, then write, record by record;
   - `rollback(batch, dryRun)` — undo one batch (decision 6).
   Each returns an `ImportReport`: counts per record kind, the rejected records (source id, stable
   code, message), the blockers (an unmapped currency) and the batch id. Artisan calls them off the
   game threads, one run at a time per module, and refuses `apply` while a conflicting plugin is
   enabled. *Rejected:* a generic record model in Artisan (`ImportRecord` with typed fields): it
   would freeze one module's shapes into the public API for no reader but that module.
3. **Idempotence is the module's ledger, in the same transaction.** Each module keeps
   `{prefix}import_map(source, source_id, target, batch, imported_at)`, written in the transaction
   that writes the record. A record already in the ledger is skipped and counted as such; a record
   whose items cannot all be read stays in the source and is reported, never half-imported.
   Auctions does this today (`AuctionStore.importRecord`). *Rejected:* a ledger table owned by
   Artisan: the module would write it on Artisan's connection, outside its own transaction.
4. **Each module defines a canonical, versioned JSON format, and accepts it as a source.**
   `{"format": "auctions/1", "source": "<free text>", "records": [...]}`, with a JSON schema in the
   module's jar and its docs. Its source `<module>:json` reads a file from
   `plugins/Artisan/imports/`. The built-in converters (zAuctionHouse…) are readers that produce the
   same records in memory and can write them to that folder (`export`): the canonical file is the
   support boundary. An admin whose import misbehaves sends the file; we replay it.
   A format version is never changed, only added (`auctions/2` next to `auctions/1`).
5. **Built-in converters for the competitors that cover most servers, written by hand and tested
   on real exports.** Auctions: zAuctionHouse v3 and v4, AuctionHouse (Kiranhart). Quests:
   BeautyQuests (content and progress in one importer, the exception of decision 1).
6. **Every applied run is a batch, and a batch can be rolled back while its records are untouched.**
   Rollback removes what the batch created **and is still as the import left it** (a listing still
   active at its imported version, a claim not taken, a sale row). What has lived since (bought,
   bid on, claimed) is kept and listed: rolling back never moves money a player moved. Rollback is
   a dry run first, like an import.
7. **One entry point, aliases kept.** `/artisan import` (console and `artisan.admin.import`):
   `list`, `<source> [file] [confirm]`, `rollback <module> <batch> [confirm]`, `history`.
   Without `confirm`, a dry run. Artisan logs each run with its report in `artisan_import_runs`
   (who, when, source, dry or applied, batch, report as JSON). A module's own command
   (`/ah admin import`) stays and calls the same importer. The editor's **Imports** tab of a server
   (`artisan.editor.config`) uses the same `ImportRuns`: the sources, a dry run and its report, the
   write on a second click, the history and its rollback (a dry run first). The run happens on the
   server that holds the data: the hub relays `imports_fetch` and `import_start`, which answers
   with the batch before the run ends, and the editor reads the report back from the log. A run
   that throws is logged like any other, and a failed `apply` as applied: what it wrote before
   stopping can be rolled back. MCP tools may use the same registry later.
8. **The AI writes a mapping, never data, and never code that runs on the server.** For a plugin
   with no built-in converter, the AI reads a sample the admin gives (a few rows or files, read
   only) and writes a **declarative mapping**: a `SELECT` on a read-only connection or field paths
   over YAML/JSON, whose output columns are the canonical fields. Artisan runs the mapping
   deterministically into the canonical file; the admin reads the dry-run report; the importer
   writes. *Rejected:* the AI writing rows (not reproducible, and no admin will grant it), and the
   AI writing a script run on the server (arbitrary code execution, at the AI's or a prompt
   injection's will). A mapping that works well becomes a built-in converter.

## Consequences

- One API addition (`importing`, next internal minor) and `MIN_API_VERSION` raised in each module
  that registers an importer; a module stays installable on an older Artisan with only its own
  command if it checks `api.apiVersion` before registering.
- Auctions keeps its importer and its ledger; it adds the batch column, rollback, the `json` source
  and its schema, and registers with Artisan.
- Support reproduces an import from the canonical file, without the admin's database.
- Decision 8 is a later batch; until then a plugin without a converter is imported by writing the
  canonical file by hand or with any tool, then `/artisan import <module>:json`.
