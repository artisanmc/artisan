# Le plugin découpé en modules Gradle

**Statut :** accepté (2026-10-12). Première étape de la phase A du plan
d'auto-hébergement : le jar livré ne change pas de comportement.

## Contexte

Le plugin était un seul module de 17 500 lignes. Le code sans Bukkit (langage
d'actions, expressions, modèle, lecture des projets) existait déjà, mais rien ne
l'empêchait d'importer `org.bukkit`. Un hub web (Javalin) et un point d'entrée
Velocity doivent pouvoir réutiliser ce code sans charger Paper.

## Décisions

**① La frontière est un module Gradle, pas une convention.** Un module qui n'a
pas `paper-api` dans son classpath ne peut pas l'importer : le compilateur tient
la règle.

| Module | Contenu | Dépend de |
|---|---|---|
| `api` | Surface publique pour les add-ons (`net.artisanmc.modules.api`), en Java depuis l'API 2.0.0. Publiée comme `artisan-core-api`. | `paper-api` (compileOnly) |
| `core` | Domaine sans plateforme : projets, modèle, langage d'actions, expressions, parseurs de menus. | `api`, Jackson |
| `database` | Pools HikariCP par plugin, réglages de connexion. | `api`, HikariCP (compileOnly) |
| `paper` | Tout ce qui importe Bukkit, et la racine de composition (`ArtisanPlugin`). Produit le jar. | les trois, `paper-api` |

**② Les packages ne changent pas.** Un fichier change de module, pas de nom
complet : le jar contient les mêmes classes, et l'historique git suit les
déplacements.

**③ `core` ne contient que du code fermé sur lui-même.** Le moteur d'exécution
des actions, le rendu et les adaptateurs d'E/S (WebSocket, mise à jour, objets
custom, délégation de pack) restent dans `paper` pour l'instant ; ils en sortent
quand un port les remplace, pas avant.

*Rejeté :* une convention de packages vérifiée par un test (ArchUnit seul). Le
compilateur est plus strict et ne demande aucune maintenance.

## Conséquences

- Les tests suivent leur code : `core` et `database` se testent sans MockBukkit.
- Le jar sort de `plugin/paper/build/libs/`.
- `deploy/api-version.mjs` surveille `plugin/api/src/main/`.
