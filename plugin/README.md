# Artisan plugin

| Module | Role | Forbidden |
|---|---|---|
| `api` | Public add-on surface, **in Java** (API 2.0.0), published as `net.artisanmc:artisan-core-api`. | Depending on another module; a Kotlin class in `src/main`. |
| `core` | Domain: projects, model, action language, expressions, parsers. | Bukkit, JDBC, HTTP. |
| `database` | Per-plugin connection pools (H2, MySQL, MariaDB). | Bukkit. |
| `hub` | The editor's web server (Jetty): editor files, API, sessions opened by `/artisan editor`. | Bukkit. |
| `pack` | The server's Java resource pack built from its Projects' files: Kotlin port of the editor's builder (`editor/src/lib/pack`), same bytes, locked by `testdata/resource-pack-conformance.json`. Reads YAML as the editor does (1.2). | Bukkit, Jetty, any I/O but the jar's resources. |
| `tunnel` | The editor tunnel's wire (`Frame`), shared by the hub's client and the tunnel server (ADR `editor-tunnel`). | Any network code, any platform. |
| `tunnel-server` | Standalone tunnel server (Jetty), outside the plugin jar; deployed from `deploy/tunnel-server/`. | Depending on `core`, `hub` or `paper` (outside tests). |
| `runtime` | What runs a Project's content on Paper without the editor: action engine and core actions, conditions, items (vanilla, custom, captured), texts, translations, schedulers, database pool. Consumed by `paper`, not published (ADR `runtime-library`). | Menu rendering, presence, the hub. |
| `paper` | Paper integration: listeners, commands, menu and dialog rendering, WebSocket, resource pack. Composition root in `ArtisanPlugin.onEnable`, which assembles `ArtisanApiFactory` (add-on API), `SuiteDatabase` (suite database, Versions), `EditorHost` (editor or link to the hub) and `RuntimeAssembly` (what `/artisan reload` rebuilds). Produces the jar. | — |

```bash
./gradlew test        # every module
./gradlew shadowJar   # → paper/build/libs/artisan-plugin-<version>-all.jar
./gradlew shadowJar -PwithEditor   # with the editor served by the plugin (npm run build:self-hosted)
```

Threads: the plugin runs on Paper, Folia and Leaf. Scheduling goes through the `Scheduler` port,
never through `Bukkit.getScheduler()` (see `docs/architecture/invariants.md`, Threads section).

Decision and context: `docs/decisions/plugin-gradle-modules.md`, `docs/decisions/runtime-library.md`.
