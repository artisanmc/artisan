# Artisan's runtime is a library — a suite module starts without the plugin

**Status:** accepted (2026-10-18) for ① and ②; ③, ④ and ⑤ **withdrawn** the same day (see
the amendment at the end of the document). The Gradle module `runtime` stays, consumed by
`paper`; it is not published and no suite plugin carries a copy of it.

## Context

Each plugin of the suite (Quests, Guilds, Lands, Boosts, Warps) declares Artisan as a
required dependency and gets from its `ArtisanAPI` the action engine (rewards), the
conditions (prerequisites), item comparison (objectives), translations and, for some, the
database. If the Artisan plugin does not start, none of them starts: a server without
quests, without guilds, without lands, because of an editor problem.

What these plugins draw from Artisan falls into two categories:

- **pure code** — parse and run a chain, evaluate a condition, build or compare an item,
  load a message bundle, open a pool: one copy per plugin bothers nobody;
- **shared state** — the registries (actions, data sources, Document kinds, models),
  presence towards the editor, rendering of menus and dialogs, the resource pack: there
  must be exactly one owner in the JVM.

A library solves the first category and can do nothing for the second. The "everything
in a library, menus included" option was ruled out: N menu engines of different versions
facing a single editor, and the end of references and data sources between modules.

## Decisions

**① A Gradle module `runtime`, between `core` and `paper`.** It contains what runs a
Project's content on a Paper server without the editor: `engine/` (`ActionExecutor`,
`ConditionEvaluator`, `ContextBinder`, `TemplateScope`, the core actions and their table
`CoreActionHandlers`, `MenuProvider` and `MenuSessionStore` as interfaces and stores),
`session/` (navigation history), `integrations/` (Vault, PlaceholderAPI, WorldGuard,
HeadDatabase), `customitems/` (Nexo, Oraxen, ItemsAdder), `items/` (specs, captured
items, `ItemDetails`), `text/`, `scheduling/`, `lang/` (bundles and `TranslationsApi`),
`database/` (`PooledDatabase`) and `config/EnvironmentFile`. It depends on `api`, `core`,
`database` and on `paper-api` as `compileOnly`. Packages do not change (rule ② of
`plugin-gradle-modules`).

**② `paper` keeps the shared state**: `SyncedMenuProvider` and rendering, the listeners,
the packets, presence and the hub, the resource pack, the `/artisan` commands, the
composition root. It depends on `runtime` and uses it as is: one engine, one
implementation of the core actions, Artisan's jar is the same as before.

**③ `artisan-runtime` is published** on `repo.artisanmc.net`, versioned with the plugin
(`-PartisanVersion`), a jar that embeds `artisan-core`, `artisan-database` and Jackson
without relocation, with `artisan-core-api` as `provided` in its POM. A consumer **shades
it relocated** (`net.artisanmc.plugin` and `com.fasterxml.jackson` at least): each plugin
its own copy, none found by Bukkit's cross-plugin class lookup. `artisan-core-api` stays
`compileOnly`, never shaded: `ServicesManager.load(ArtisanAPI.class)` compares class
identities.
The jar also carries `kotlin-stdlib` and `kotlin-reflect`, not relocated as in Artisan's
jar (relocating `kotlin` breaks `kotlin-reflect`): each plugin loads its copy before the
global lookup, and no Kotlin type crosses the API, which is Java.

*Rejected:* a shaded library **without** relocation. Bukkit's classloader resolves
classes across plugins: the version loaded first would win for everyone, without anyone
having chosen it — worse than a dependency plugin.

**④ A suite module becomes an optional dependency of Artisan.** With Artisan, it
registers there as today (actions, sources, kinds, editor screen) and runs its chains
through `api.getActions()`. Without Artisan, it instantiates the runtime from its copy:
the core actions (`give_item`, `send_message`, `run_command`, …) run, an action of
another module is absent from the local registry, logged once and skipped; conditions are
evaluated locally; the Documents of its kinds are read from disk by `artisan-core`,
reloaded by its own command; its menus answer "interface unavailable". The choice is made
once, at `onEnable`. Gameplay and persistence no longer depend on Artisan; menus,
cross-module actions and editor-pushed reloading do.

**⑤ The database follows the same rule** (amendment of `suite-foundation-database`,
`ModuleDatabase` in the runtime): a module opens its pool through the library. At
startup, if `plugins/Artisan/environment.yml` exists, its `database` section is read,
never written; otherwise the module writes a default section (H2) in its own config and
uses it; `database.own: true` on the module's side keeps its section whatever Artisan has,
and the log says which of the two is read. Nothing is created under `plugins/Artisan/`.
With H2, one file per module; a single database with MySQL/MariaDB, tables prefixed as
today.

## Consequences

- `ActionExecutor` already takes the registry as a parameter; step ① is a file move and
  three opened `internal` visibilities (`ItemSpecs`, `ContextBinder.shape/interpolateValues`,
  `MenuSlots.Client`), read by `paper` from another module.
- Tests follow their code: those that load `ArtisanPlugin` through MockBukkit stay in
  `paper`, the others go to `runtime` (MockBukkit is a test dependency there).
- `RuntimePackageCyclesTest` guards the runtime's package DAG, like `core` and `paper`.
- A consumer in degraded mode remains to be written plugin by plugin (ArtisanQuests as
  pilot); what this requires of the runtime (a `MenuProvider` that finds nothing and says
  so) will come with it.

## Amendment 2026-10-18 — no copy of the runtime: the Artisan plugin stays required

The ArtisanQuests pilot (PR msquests#23, closed without merge) showed what ③ and ④ cost:
the API must be embedded **relocated** next to the runtime (without the Artisan plugin
its classes do not exist, and `ModuleDatabase` as well as the engine reference them,
which ③ had not seen), hence two copies of the same classes in the JVM and a conversion
bridge between them; an "Artisan present or absent" switch and one adapter per service in
each plugin; an additional relocation pass for the JVM descriptors that `@kotlin.Metadata`
keeps as text; 13 MB of runtime per plugin. Putting it in the library (a facade returning
the plugin's `ArtisanAPI` or a local one) required decoupling the 28 runtime files that
import the API package. A passive shared library jar solves all of this but amounts to a
jar that everyone depends on, which the owner refuses.

What ④ aimed at was that an Artisan problem should not immobilize quests, guilds and
lands. Yet the copy changes nothing there: an engine bug is the same in the copy, and what
breaks an active plugin (hub, port, database, packets, sync) is already off the
dependents' path. `ArtisanPlugin.onEnable` builds and registers the API before any step
that can fail; the failure of the menu packets, the suite's database and the editor is caught;
and since this amendment the command, the menu listener and the whole game side are in
place before the editor starts, which is itself under a guard that logs at SEVERE and
leaves the plugin enabled (`ArtisanPluginEnableResilienceTest`). Two cases remain where
everything falls: the Artisan jar absent or refused at load, and an engine bug, which a
copy would not have avoided.

Withdrawn decisions: ③ (publication of `artisan-runtime`, `ModuleDatabase`), ④ (optional
dependency and degraded mode), ⑤ (pool opened by the module; the amendment of
`suite-foundation-database` is withdrawn with it, `api.database` remains the way). The
suite's plugins declare Artisan `required: true` and take everything from its
`ArtisanAPI`.
