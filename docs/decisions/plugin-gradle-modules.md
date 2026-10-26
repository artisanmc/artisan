# The plugin split into Gradle modules

**Status:** accepted (2026-10-12). First step of phase A of the self-hosting plan:
the shipped jar does not change behavior.

## Context

The plugin was a single 17,500-line module. The Bukkit-free code (action language,
expressions, model, project reading) already existed, but nothing prevented it from
importing `org.bukkit`. A web hub (Javalin) and a Velocity entry point must be able to
reuse this code without loading Paper.

## Decisions

**① The boundary is a Gradle module, not a convention.** A module that does not have
`paper-api` on its classpath cannot import it: the compiler enforces the rule.

| Module | Content | Depends on |
|---|---|---|
| `api` | Public surface for add-ons (`net.artisanmc.modules.api`), in Java since API 2.0.0. Published as `artisan-core-api`. | `paper-api` (compileOnly) |
| `core` | Platform-free domain: projects, model, action language, expressions, menu parsers. | `api`, Jackson |
| `database` | Per-plugin HikariCP pools, connection settings. | `api`, HikariCP (compileOnly) |
| `paper` | Everything that imports Bukkit, and the composition root (`ArtisanPlugin`). Produces the jar. | the three, `paper-api` |

**② Packages do not change.** A file changes module, not fully qualified name: the jar
contains the same classes, and git history follows the moves.

**③ `core` only contains self-contained code.** The action execution engine, rendering
and the I/O adapters (WebSocket, update, custom objects, pack delegation) stay in
`paper` for now; they leave when a port replaces them, not before.

*Rejected:* a package convention checked by a test (ArchUnit alone). The compiler is
stricter and requires no maintenance.

## Consequences

- Tests follow their code: `core` and `database` are tested without MockBukkit.
- The jar comes out of `plugin/paper/build/libs/`.
- `deploy/api-version.mjs` watches `plugin/api/src/main/`.

### Amendment 2026-10-18 — the engine leaves `paper`

Rule ③ is lifted by the ADR `runtime-library`: the action execution engine, conditions,
items, translations and the database pool live in the `runtime` module (`paper-api` as
`compileOnly`), which `paper` consumes and which the suite shades relocated. Menu
rendering, presence and the hub stay in `paper`.
