# Plugin Artisan

| Module | Rôle | Interdit |
|---|---|---|
| `api` | Surface publique des add-ons, **en Java** (API 2.0.0), publiée comme `net.artisanmc:artisan-core-api`. | Dépendre d'un autre module ; une classe Kotlin dans `src/main`. |
| `core` | Domaine : projets, modèle, langage d'actions, expressions, parseurs. | Bukkit, JDBC, HTTP. |
| `database` | Pools de connexions par plugin (H2, MySQL, MariaDB). | Bukkit. |
| `hub` | Serveur web de l'éditeur (Jetty) : fichiers de l'éditeur, API, sessions ouvertes par `/artisan editor`. | Bukkit. |
| `runtime` | Ce qui exécute le contenu d'un Project sur Paper sans l'éditeur : moteur d'actions et actions core, conditions, items (vanilla, custom, capturés), textes, traductions, schedulers, pool de la base. Consommé par `paper`, pas publié (ADR `runtime-library`). | Le rendu des menus, la présence, le hub. |
| `paper` | Intégration Paper : listeners, commandes, rendu des menus et dialogs, WebSocket, pack de ressources. Racine de composition dans `ArtisanPlugin.onEnable`, qui assemble `ArtisanApiFactory` (API des add-ons), `SuiteDatabase` (base de la suite, Versions), `EditorHost` (éditeur ou lien au hub) et `RuntimeAssembly` (ce que `/artisan reload` reconstruit). Produit le jar. | — |

```bash
./gradlew test        # tous les modules
./gradlew shadowJar   # → paper/build/libs/artisan-plugin-<version>-all.jar
./gradlew shadowJar -PwithEditor   # avec l'éditeur servi par le plugin (npm run build:self-hosted)
```

Threads : le plugin tourne sur Paper, Folia et Leaf. Planifier passe par le port `Scheduler`,
jamais par `Bukkit.getScheduler()` (voir `docs/architecture/invariants.md`, section Threads).

Décision et contexte : `docs/decisions/plugin-gradle-modules.md`, `docs/decisions/runtime-library.md`.
