# Plugin Artisan

| Module | Rôle | Interdit |
|---|---|---|
| `api` | Surface publique des add-ons, publiée comme `net.artisanmc:artisan-core-api`. | Dépendre d'un autre module. |
| `core` | Domaine : projets, modèle, langage d'actions, expressions, parseurs. | Bukkit, JDBC, HTTP. |
| `database` | Pools de connexions par plugin (H2, MySQL, MariaDB). | Bukkit. |
| `paper` | Intégration Paper : listeners, commandes, rendu, WebSocket. Racine de composition dans `ArtisanPlugin.onEnable`. Produit le jar. | — |

```bash
./gradlew test        # tous les modules
./gradlew shadowJar   # → paper/build/libs/artisan-plugin-<version>-all.jar
```

Décision et contexte : `docs/decisions/plugin-gradle-modules.md`.
